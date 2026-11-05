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
TABLA_CATEGORIAS = os.environ["TABLA_CATEGORIAS"]
MODELO = os.environ["BEDROCK_MODEL_ID"]
ZONA = ZoneInfo(os.environ.get("ZONA_HORARIA", "America/Lima"))

MAX_ACCIONES = 6
MAX_TAREAS_CONTEXTO = 20
META_CATEGORIAS = "__META__"
PATRON_ULID = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")
PATRON_DIA = re.compile(r"\d{4}-\d{2}-\d{2}")


dynamodb = boto3.resource("dynamodb")
cliente_dynamodb = boto3.client("dynamodb")
tareas_table = dynamodb.Table(TABLA_TAREAS)
propuestas_table = dynamodb.Table(TABLA_PROPUESTAS)
categorias_table = dynamodb.Table(TABLA_CATEGORIAS)
serializador = TypeSerializer()

bedrock = boto3.client(
    "bedrock-runtime",
    config=Config(
        connect_timeout=5,
        read_timeout=150,
        retries={"max_attempts": 2, "mode": "standard"},
    ),
)

PROMPT = Path(__file__).with_name("prompt.txt").read_text(encoding="utf-8")

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
                    "category_id": {"type": ["string", "null"]},
                },
                "required": ["op", "id", "title", "due", "category_id"],
                "additionalProperties": False,
            },
        },
        "reply": {"type": "string"},
    },
    "required": ["actions", "reply"],
    "additionalProperties": False,
}


class ConflictoConversacion(ValueError):
    """Una propuesta cambió o existen varias propuestas activas."""


class CategoriasNoInicializadas(ValueError):
    """Las categorías predeterminadas aún no fueron creadas."""


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(datos, ensure_ascii=False),
    }


def serializar_item(item):
    return {clave: serializador.serialize(valor) for clave, valor in item.items()}


def fecha_local(valor):
    if not valor:
        return None
    fecha = datetime.fromisoformat(valor)
    if fecha.utcoffset() is None:
        raise ValueError("Fecha almacenada sin zona horaria")
    return fecha.astimezone(ZONA).date().isoformat()


def obtener_fecha_tarea(item):
    if item.get("fecha_dia"):
        return item["fecha_dia"]
    return fecha_local(item.get("fecha_hacer"))


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
                    "due": obtener_fecha_tarea(item),
                    "created_at": fecha_local(item.get("fecha_creacion")),
                    "category_id": item.get("id_categoria"),
                    "category_name": item.get("categoria"),
                }
            )
            if len(tareas) > MAX_TAREAS_CONTEXTO:
                raise ValueError("Demasiadas tareas pendientes para una solicitud")

        inicio = resultado.get("LastEvaluatedKey")
        if not inicio:
            break

    return tareas


def obtener_categorias(user_id):
    # El catálogo permite como máximo 10 categorías más el registro __META__.
    resultado = categorias_table.query(
        KeyConditionExpression=Key("id_usuario").eq(user_id),
        ConsistentRead=True,
    )
    items = resultado.get("Items", [])
    if not any(item["id_categoria"] == META_CATEGORIAS for item in items):
        raise CategoriasNoInicializadas(
            "Inicializa las categorías llamando primero a GET /categorias"
        )
    categorias = [
        {
            "id": item["id_categoria"],
            "nombre": item["nombre"],
            "descripcion": item.get("descripcion", ""),
        }
        for item in items
        if item["id_categoria"] != META_CATEGORIAS
    ]
    return sorted(categorias, key=lambda categoria: categoria["nombre"].casefold())


def buscar_propuesta_pendiente(user_id):
    pendientes = []
    inicio = None
    while True:
        parametros = {
            "KeyConditionExpression": Key("id_usuario").eq(user_id),
            "ConsistentRead": True,
        }
        if inicio:
            parametros["ExclusiveStartKey"] = inicio
        resultado = propuestas_table.query(**parametros)
        pendientes.extend(
            item
            for item in resultado.get("Items", [])
            if item.get("status") == "pendiente" and not item.get("id_siguiente")
        )
        inicio = resultado.get("LastEvaluatedKey")
        if not inicio:
            break
    if len(pendientes) > 1:
        raise ConflictoConversacion(
            "Hay más de una propuesta pendiente; revisa los datos del usuario"
        )
    return pendientes[0] if pendientes else None


def validar_acciones(salida, tareas_abiertas, categorias, hoy):
    if not isinstance(salida, dict) or set(salida) != {"actions", "reply"}:
        raise ValueError("La salida del modelo tiene campos incorrectos")

    acciones = salida["actions"]
    respuesta = salida["reply"]
    if not isinstance(respuesta, str) or not respuesta.strip():
        raise ValueError("Respuesta conversacional inválida")
    if not isinstance(acciones, list) or len(acciones) > MAX_ACCIONES:
        raise ValueError("Cantidad de acciones inválida")

    tareas_por_id = {tarea["id"]: tarea for tarea in tareas_abiertas}
    categorias_por_id = {categoria["id"]: categoria for categoria in categorias}
    ids_utilizados = set()

    for accion in acciones:
        if not isinstance(accion, dict) or set(accion) != {
            "op",
            "id",
            "title",
            "due",
            "category_id",
        }:
            raise ValueError("Campos de acción incorrectos")

        op = accion["op"]
        id_tarea = accion["id"]
        titulo = accion["title"]
        dia = accion["due"]
        id_categoria = accion["category_id"]

        if op not in {"create", "update", "delete", "complete"}:
            raise ValueError("Operación desconocida")

        if op == "create":
            if id_tarea is not None:
                raise ValueError("Create no debe tener ID de tarea")
            if categorias_por_id:
                if (
                    not isinstance(id_categoria, str)
                    or id_categoria not in categorias_por_id
                ):
                    raise ValueError(
                        "Create requiere una categoría existente del usuario"
                    )
            elif id_categoria is not None:
                raise ValueError("No existen categorías para asignar")
        else:
            if not isinstance(id_tarea, str) or id_tarea not in tareas_por_id:
                raise ValueError("La tarea no existe o no está pendiente")
            if id_tarea in ids_utilizados:
                raise ValueError("Acciones duplicadas sobre una tarea")
            ids_utilizados.add(id_tarea)
            if id_categoria is not None:
                raise ValueError("Solo create puede elegir una categoría")

        if op in {"create", "update"}:
            if not isinstance(titulo, str) or not titulo.strip():
                raise ValueError("Título inválido")
            titulo = titulo.strip()
            if len(titulo) > 100:
                raise ValueError("El título supera 100 caracteres")
            accion["title"] = titulo
        elif titulo is not None or dia is not None:
            raise ValueError("Complete y delete requieren title y due nulos")

        if op in {"create", "update"} and dia is not None:
            if not isinstance(dia, str) or not PATRON_DIA.fullmatch(dia):
                raise ValueError("Fecha inválida: se requiere YYYY-MM-DD")
            try:
                fecha = date.fromisoformat(dia)
            except ValueError as exc:
                raise ValueError("Fecha inexistente") from exc
            if fecha.isoformat() != dia:
                raise ValueError("Fecha no canónica")

            # Una actualización puede conservar una fecha vencida anterior.
            anterior = tareas_por_id[id_tarea]["due"] if op == "update" else None
            if fecha < hoy and dia != anterior:
                raise ValueError("No se puede asignar una fecha pasada")

    return acciones, respuesta.strip()


def lambda_handler(event, context):
    try:
        user_id = event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]

        try:
            body = json.loads(event.get("body") or "{}")
        except (json.JSONDecodeError, TypeError):
            return responder(400, {"error": "JSON inválido"})
        if not isinstance(body, dict):
            return responder(400, {"error": "Se esperaba un objeto JSON"})
        if set(body) - {"mensaje", "id_propuesta_anterior"}:
            return responder(400, {"error": "Campos no permitidos"})

        mensaje = body.get("mensaje")
        if not isinstance(mensaje, str) or not 1 <= len(mensaje.strip()) <= 500:
            return responder(
                400, {"error": "El mensaje debe tener entre 1 y 500 caracteres"}
            )
        mensaje = mensaje.strip()

        id_anterior = body.get("id_propuesta_anterior")
        if id_anterior is not None and (
            not isinstance(id_anterior, str) or not PATRON_ULID.fullmatch(id_anterior)
        ):
            return responder(400, {"error": "ID de propuesta anterior inválido"})

        tareas = obtener_tareas_abiertas(user_id)
        anterior = buscar_propuesta_pendiente(user_id)
        if id_anterior is not None and (
            anterior is None or anterior["id_propuesta"] != id_anterior
        ):
            raise ConflictoConversacion(
                "La propuesta indicada no es la propuesta vigente"
            )
        categorias = obtener_categorias(user_id)
        ahora_local = datetime.now(ZONA)
        id_hilo = anterior["id_hilo"] if anterior else str(ulid.new())

        referencias = {
            "fecha_actual": ahora_local.date().isoformat(),
            "zona_horaria": str(ZONA),
            "tareas_abiertas": tareas,
            "categorias_disponibles": categorias,
            "penultimo_mensaje": anterior["mensaje_usuario"] if anterior else None,
            "penultima_respuesta": anterior["respuesta_bot"] if anterior else None,
            "acciones_previas": anterior["acciones"] if anterior else [],
            "ultimo_mensaje": mensaje,
        }

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
        bloques = respuesta_ia.get("output", {}).get("message", {}).get("content", [])
        textos = [bloque["text"] for bloque in bloques if "text" in bloque]
        if len(textos) != 1:
            return responder(502, {"error": "Formato de respuesta inesperado"})

        try:
            salida = json.loads(textos[0])
            acciones, reply = validar_acciones(
                salida, tareas, categorias, ahora_local.date()
            )
        except (ValueError, TypeError) as exc:
            print(f"Validación IA: {exc}")
            return responder(502, {"error": "La propuesta no pasó las validaciones"})

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
                            "fecha_resolucion = :fecha, id_siguiente = :siguiente"
                        ),
                        "ConditionExpression": (
                            "#status = :pendiente AND attribute_not_exists(id_siguiente)"
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

    except ConflictoConversacion as exc:
        return responder(409, {"error": str(exc)})
    except CategoriasNoInicializadas as exc:
        return responder(409, {"error": str(exc)})
    except ValueError as exc:
        return responder(400, {"error": str(exc)})
    except ClientError as exc:
        codigo = exc.response["Error"]["Code"]
        print(f"Error AWS: {codigo}")
        if codigo in {
            "ConditionalCheckFailedException",
            "TransactionCanceledException",
        }:
            return responder(
                409,
                {
                    "error": "La conversación cambió; actualiza el chat antes de continuar"
                },
            )
        return responder(503, {"error": "No se pudo procesar la solicitud"})
    except Exception as exc:
        print(f"Error: {type(exc).__name__}: {exc}")
        return responder(500, {"error": "Error interno del servidor"})
