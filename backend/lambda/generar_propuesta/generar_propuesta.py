import json
import os
import re
import time

from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import boto3
import ulid
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.config import Config
from botocore.exceptions import ClientError


TABLA_TAREAS = os.environ["TABLA_TAREAS"]
TABLA_PROPUESTAS = os.environ["TABLA_PROPUESTAS"]
MODELO = os.environ["BEDROCK_MODEL_ID"]
ZONA = ZoneInfo(os.environ.get("ZONA_HORARIA", "America/Lima"))

dynamodb = boto3.resource("dynamodb")
cliente_dynamodb = boto3.client("dynamodb")

tareas_table = dynamodb.Table(TABLA_TAREAS)
propuestas_table = dynamodb.Table(TABLA_PROPUESTAS)

bedrock = boto3.client(
    "bedrock-runtime",
    config=Config(
        connect_timeout=5,
        read_timeout=150,
        retries={"max_attempts": 2, "mode": "standard"},
    ),
)

serializador = TypeSerializer()

PROMPT = Path(__file__).with_name("prompt.txt").read_text(encoding="utf-8")

MAX_ACCIONES = 6
MAX_TAREAS_CONTEXTO = 100


ESQUEMA_RESPUESTA = {
    "type": "object",
    "properties": {
        "actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "op": {
                        "type": "string",
                        "enum": ["create", "update", "delete", "complete"],
                    },
                    "id": {"type": ["string", "null"]},
                    "title": {"type": ["string", "null"]},
                    "due": {"type": ["string", "null"]},
                },
                "required": ["op", "id", "title", "due"],
                "additionalProperties": False,
            },
        },
        "reply": {"type": "string"},
    },
    "required": ["actions", "reply"],
    "additionalProperties": False,
}


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(datos, ensure_ascii=False),
    }


def serializar_item(item):
    return {clave: serializador.serialize(valor) for clave, valor in item.items()}


def fecha_local(valor):
    if not valor:
        return None

    fecha = datetime.fromisoformat(valor)

    if fecha.tzinfo is None:
        raise ValueError("Fecha almacenada sin zona horaria")

    return fecha.astimezone(ZONA).date().isoformat()


def obtener_tareas_abiertas(user_id):
    tareas = []
    inicio = None

    while True:
        parametros = {
            "KeyConditionExpression": Key("id_usuario").eq(user_id),
            "ConsistentRead": True,
        }

        if inicio:
            parametros["ExclusiveStartKey"] = inicio

        resultado = tareas_table.query(**parametros)

        for item in resultado.get("Items", []):
            if item.get("estado") != "pendiente":
                continue

            tareas.append(
                {
                    "id": item["id_tarea"],
                    "title": item["nombre"],
                    "due": fecha_local(item.get("fecha_hacer")),
                    "created_at": fecha_local(item["fecha_creacion"]),
                }
            )

            if len(tareas) > MAX_TAREAS_CONTEXTO:
                raise ValueError("Demasiadas tareas abiertas para una solicitud")

        inicio = resultado.get("LastEvaluatedKey")

        if not inicio:
            break

    return tareas


def obtener_propuesta_anterior(user_id, id_anterior):
    if not id_anterior:
        return None

    if not isinstance(id_anterior, str):
        raise ValueError("ID de propuesta anterior inválido")

    resultado = propuestas_table.get_item(
        Key={"id_usuario": user_id, "id_propuesta": id_anterior}, ConsistentRead=True
    )

    anterior = resultado.get("Item")

    if not anterior:
        raise ValueError("Propuesta anterior no encontrada")

    if anterior.get("status") != "pendiente":
        raise ValueError("La propuesta anterior ya fue resuelta")

    if anterior.get("id_siguiente"):
        raise ValueError("La conversación ya tiene un mensaje posterior")

    return anterior


def validar_acciones(salida, tareas_abiertas, hoy):
    if not isinstance(salida, dict):
        raise ValueError("La salida no es un objeto")

    if set(salida) != {"actions", "reply"}:
        raise ValueError("Claves incorrectas")

    acciones = salida["actions"]
    reply = salida["reply"]

    if not isinstance(reply, str) or not reply.strip():
        raise ValueError("Respuesta conversacional inválida")

    if not isinstance(acciones, list):
        raise ValueError("Acciones inválidas")

    if len(acciones) > MAX_ACCIONES:
        raise ValueError("Se superó el límite de acciones")

    tareas_por_id = {tarea["id"]: tarea for tarea in tareas_abiertas}

    ids_utilizados = set()

    for accion in acciones:
        if not isinstance(accion, dict):
            raise ValueError("Acción inválida")

        if set(accion) != {"op", "id", "title", "due"}:
            raise ValueError("Campos de acción incorrectos")

        op = accion["op"]
        id_tarea = accion["id"]
        titulo = accion["title"]
        due = accion["due"]

        if op not in {"create", "update", "delete", "complete"}:
            raise ValueError("Operación desconocida")

        if op == "create":
            if id_tarea is not None:
                raise ValueError("Create no debe tener ID")

        else:
            if not isinstance(id_tarea, str):
                raise ValueError("ID inválido")

            if id_tarea not in tareas_por_id:
                raise ValueError("ID inexistente o no disponible")

            if id_tarea in ids_utilizados:
                raise ValueError("Acciones duplicadas sobre una tarea")

            ids_utilizados.add(id_tarea)

        if op in {"create", "update"}:
            if not isinstance(titulo, str):
                raise ValueError("Título inválido")

            titulo = titulo.strip()

            if not titulo or len(titulo) > 100:
                raise ValueError("Longitud de título inválida")

            accion["title"] = titulo

        elif titulo is not None or due is not None:
            raise ValueError("Delete y complete requieren valores null")

        if op in {"create", "update"} and due is not None:
            if not isinstance(due, str):
                raise ValueError("Fecha inválida")

            try:
                fecha = date.fromisoformat(due)
            except ValueError:
                raise ValueError("Fecha no es ISO 8601")

            if fecha.isoformat() != due:
                raise ValueError("Fecha no canónica")

            # Permitir conservar una fecha vencida existente
            fecha_anterior = tareas_por_id[id_tarea]["due"] if op == "update" else None

            if fecha < hoy and due != fecha_anterior:
                raise ValueError("No se puede asignar una fecha pasada")

    return acciones, reply.strip()


def lambda_handler(event, context):
    try:
        # 1. Usuario autenticado
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]

        # 2. Body de la solicitud
        try:
            body = json.loads(event.get("body") or "{}")
        except (json.JSONDecodeError, TypeError):
            return responder(400, {"error": "JSON inválido"})

        if not isinstance(body, dict):
            return responder(400, {"error": "Body inválido"})

        mensaje = body.get("mensaje")
        id_anterior = body.get("id_propuesta_anterior")

        if not isinstance(mensaje, str):
            return responder(400, {"error": "Mensaje obligatorio"})

        mensaje = mensaje.strip()

        if not mensaje or len(mensaje) > 500:
            return responder(
                400, {"error": "El mensaje debe tener entre 1 y 500 caracteres"}
            )

        # 3. Consultar tareas y contexto
        tareas = obtener_tareas_abiertas(user_id)

        anterior = obtener_propuesta_anterior(user_id, id_anterior)

        ahora_local = datetime.now(ZONA)

        id_hilo = anterior["id_hilo"] if anterior else str(ulid.new())

        referencias = {
            "fecha_actual": ahora_local.date().isoformat(),
            "zona_horaria": str(ZONA),
            "tareas_abiertas": tareas,
            "penultimo_mensaje": (anterior["mensaje_usuario"] if anterior else None),
            "penultima_respuesta": (anterior["respuesta_bot"] if anterior else None),
            "acciones_previas": (anterior["acciones"] if anterior else []),
            "ultimo_mensaje": mensaje,
        }

        # 4. Invocar DeepSeek con formato JSON estricto
        inicio = time.perf_counter()

        respuesta_ia = bedrock.converse(
            modelId=MODELO,
            system=[{"text": PROMPT}],
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "text": json.dumps(
                                {"references": referencias}, ensure_ascii=False
                            )
                        }
                    ],
                }
            ],
            inferenceConfig={"maxTokens": 1600, "temperature": 0.1},
            outputConfig={
                "textFormat": {
                    "type": "json_schema",
                    "structure": {
                        "jsonSchema": {
                            "name": "dotol_actions",
                            "schema": json.dumps(ESQUEMA_RESPUESTA),
                        }
                    },
                }
            },
        )

        latencia_ms = int((time.perf_counter() - inicio) * 1000)

        if respuesta_ia.get("stopReason") == "max_tokens":
            return responder(502, {"error": "Respuesta del modelo incompleta"})

        # 5. Extraer JSON generado
        bloques = respuesta_ia["output"]["message"]["content"]

        textos = [bloque["text"] for bloque in bloques if "text" in bloque]

        if len(textos) != 1:
            return responder(502, {"error": "Formato de respuesta inesperado"})

        try:
            salida = json.loads(textos[0])
            acciones, reply = validar_acciones(salida, tareas, ahora_local.date())
        except (ValueError, TypeError) as e:
            print(f"Validación IA: {str(e)}")
            return responder(502, {"error": "La propuesta no pasó las validaciones"})

        # 6. Preparar registro
        id_propuesta = str(ulid.new())
        ahora_utc = datetime.now(timezone.utc).isoformat()

        uso = respuesta_ia.get("usage", {})

        propuesta = {
            "id_usuario": user_id,
            "id_propuesta": id_propuesta,
            "id_hilo": id_hilo,
            "mensaje_usuario": mensaje,
            "respuesta_bot": reply,
            "acciones": acciones,
            "status": "pendiente",
            "fecha_creacion": ahora_utc,
            "tokens_in": int(uso.get("inputTokens", 0)),
            "tokens_out": int(uso.get("outputTokens", 0)),
            "latencia_ms": latencia_ms,
        }

        # 7. Guardar propuesta de manera transaccional
        transacciones = [
            {
                "Put": {
                    "TableName": TABLA_PROPUESTAS,
                    "Item": serializar_item(propuesta),
                    "ConditionExpression": (
                        "attribute_not_exists(id_usuario) "
                        "AND attribute_not_exists(id_propuesta)"
                    ),
                }
            }
        ]

        if anterior:
            transacciones.append(
                {
                    "Update": {
                        "TableName": TABLA_PROPUESTAS,
                        "Key": serializar_item(
                            {
                                "id_usuario": user_id,
                                "id_propuesta": anterior["id_propuesta"],
                            }
                        ),
                        "UpdateExpression": (
                            "SET #status = :continuada, "
                            "fecha_resolucion = :fecha, "
                            "id_siguiente = :siguiente"
                        ),
                        "ConditionExpression": (
                            "#status = :pendiente "
                            "AND attribute_not_exists(id_siguiente)"
                        ),
                        "ExpressionAttributeNames": {"#status": "status"},
                        "ExpressionAttributeValues": {
                            ":continuada": {"S": "continuada"},
                            ":pendiente": {"S": "pendiente"},
                            ":fecha": {"S": ahora_utc},
                            ":siguiente": {"S": id_propuesta},
                        },
                    }
                }
            )

        cliente_dynamodb.transact_write_items(TransactItems=transacciones)

        # 8. Responder al frontend
        return responder(
            201,
            {
                "id_hilo": id_hilo,
                "id_propuesta": id_propuesta,
                "respuesta": reply,
                "acciones": acciones,
                "status": "pendiente",
                "tokens_in": propuesta["tokens_in"],
                "tokens_out": propuesta["tokens_out"],
                "latencia_ms": latencia_ms,
            },
        )

    except ValueError as e:
        return responder(400, {"error": str(e)})

    except ClientError as e:
        codigo = e.response["Error"]["Code"]
        print(f"Error AWS: {codigo}")

        if codigo in {
            "ConditionalCheckFailedException",
            "TransactionCanceledException",
        }:
            return responder(
                409,
                {
                    "error": (
                        "La conversación cambió. "
                        "Actualiza la propuesta antes de continuar."
                    )
                },
            )

        return responder(503, {"error": "No se pudo procesar la solicitud"})

    except Exception as e:
        print(f"Error: {type(e).__name__}: {str(e)}")
        return responder(500, {"error": "Error interno del servidor"})
