import json
import os
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import boto3
import ulid
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

TABLA_TAREAS = os.environ["TABLA_TAREAS"]
TABLA_PROPUESTAS = os.environ["TABLA_PROPUESTAS"]
ZONA = ZoneInfo("America/Lima")

db = boto3.resource("dynamodb")
cliente = boto3.client("dynamodb")
tareas = db.Table(TABLA_TAREAS)
propuestas = db.Table(TABLA_PROPUESTAS)
serializador = TypeSerializer()


def av(item):
    return {k: serializador.serialize(v) for k, v in item.items()}


def responder(status, contenido):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(contenido, ensure_ascii=False),
    }


def validar_fecha(due):
    if due is None:
        return
    if not isinstance(due, str):
        raise ValueError("Fecha inválida")
    try:
        if date.fromisoformat(due).isoformat() != due:
            raise ValueError("Fecha inválida")
    except ValueError:
        raise ValueError("Fecha inválida")


def validar_acciones(acciones):
    if not isinstance(acciones, list) or not (1 <= len(acciones) <= 6):
        raise ValueError("La propuesta debe contener entre 1 y 6 acciones")

    ids = set()
    for accion in acciones:
        if not isinstance(accion, dict) or set(accion) != {"op", "id", "title", "due"}:
            raise ValueError("Acción mal formada")

        op, id_tarea, titulo, due = (accion[k] for k in ("op", "id", "title", "due"))

        if op not in {"create", "update", "delete", "complete"}:
            raise ValueError("Operación no permitida")

        if op == "create":
            if id_tarea is not None:
                raise ValueError("Creación con ID")

        elif not isinstance(id_tarea, str) or not id_tarea:
            raise ValueError("ID de tarea inválido")

        else:
            if id_tarea in ids:
                raise ValueError("Dos acciones sobre la misma tarea")
            ids.add(id_tarea)

        if op in {"create", "update"}:
            if not isinstance(titulo, str) or not titulo.strip() or len(titulo) > 100:
                raise ValueError("Título inválido")
            validar_fecha(due)

        elif titulo is not None or due is not None:
            raise ValueError("Campos incorrectos para completar/eliminar")


def dia_de_tarea(tarea):
    if tarea.get("fecha_dia"):
        return tarea["fecha_dia"]
    if tarea.get("fecha_hacer"):
        dt = datetime.fromisoformat(tarea["fecha_hacer"])
        if dt.tzinfo is None:
            raise ValueError("Fecha almacenada sin zona horaria")
        return dt.astimezone(ZONA).date().isoformat()
    return None


def lambda_handler(event, context):
    try:
        user_id = event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
        id_propuesta = (event.get("pathParameters") or {}).get("id_propuesta")
        if not id_propuesta:
            return responder(400, {"error": "ID de propuesta obligatorio"})

        r = propuestas.get_item(
            Key={"id_usuario": user_id, "id_propuesta": id_propuesta},
            ConsistentRead=True,
        )
        propuesta = r.get("Item")
        if not propuesta:
            return responder(404, {"error": "Propuesta no encontrada"})
        if propuesta.get("status") == "aceptada":
            return responder(
                200, {"mensaje": "La propuesta ya fue aceptada", "status": "aceptada"}
            )
        if propuesta.get("status") != "pendiente" or propuesta.get("id_siguiente"):
            return responder(409, {"error": "La propuesta ya no está vigente"})

        acciones = propuesta.get("acciones")
        validar_acciones(acciones)

        ahora = datetime.now(timezone.utc).isoformat()
        hoy = datetime.now(ZONA).date()
        operaciones = []
        ids_creados = []

        for a in acciones:
            op = a["op"]
            if op == "create":
                if a["due"] is not None and date.fromisoformat(a["due"]) < hoy:
                    return responder(
                        409, {"error": "La propuesta contiene una fecha ya vencida"}
                    )
                nuevo_id = str(ulid.new())
                item = {
                    "id_usuario": user_id,
                    "id_tarea": nuevo_id,
                    "nombre": a["title"].strip(),
                    "estado": "pendiente",
                    "creada_por_ia": True,
                    "id_propuesta": id_propuesta,
                    "fecha_creacion": ahora,
                    "fecha_modificacion": ahora,
                }
                if a["due"] is not None:
                    item["fecha_dia"] = a["due"]
                operaciones.append(
                    {
                        "Put": {
                            "TableName": TABLA_TAREAS,
                            "Item": av(item),
                            "ConditionExpression": "attribute_not_exists(id_usuario) AND attribute_not_exists(id_tarea)",
                        }
                    }
                )
                ids_creados.append(nuevo_id)
                continue

            id_tarea = a["id"]
            existente = tareas.get_item(
                Key={"id_usuario": user_id, "id_tarea": id_tarea},
                ConsistentRead=True,
            ).get("Item")
            if not existente or existente.get("estado") != "pendiente":
                return responder(
                    409,
                    {"error": "Una tarea ya no está disponible; genera otra propuesta"},
                )
            version = existente.get("fecha_modificacion")
            if not isinstance(version, str):
                return responder(
                    409, {"error": "La tarea no tiene fecha de modificación válida"}
                )

            nombres = {"#estado": "estado", "#fm": "fecha_modificacion"}
            valores = {":pendiente": "pendiente", ":version": version, ":ahora": ahora}
            cambios = ["#fm = :ahora"]
            quitar = []

            if op == "update":
                nombres["#nombre"] = "nombre"
                valores[":nombre"] = a["title"].strip()
                cambios.append("#nombre = :nombre")
                if a["due"] != dia_de_tarea(existente):
                    nombres["#dia"] = "fecha_dia"
                    nombres["#hacer"] = "fecha_hacer"
                    quitar.append("#hacer")
                    if a["due"] is None:
                        quitar.append("#dia")
                    else:
                        if date.fromisoformat(a["due"]) < hoy:
                            return responder(
                                409,
                                {"error": "La propuesta contiene una fecha ya vencida"},
                            )
                        valores[":dia"] = a["due"]
                        cambios.append("#dia = :dia")
            elif op == "complete":
                nombres["#fc"] = "fecha_completada"
                valores[":completada"] = "completada"
                cambios += ["#estado = :completada", "#fc = :ahora"]
            else:  # delete lógico
                valores[":eliminada"] = "eliminada"
                cambios.append("#estado = :eliminada")

            expresion = "SET " + ", ".join(cambios)
            if quitar:
                expresion += " REMOVE " + ", ".join(quitar)

            operaciones.append(
                {
                    "Update": {
                        "TableName": TABLA_TAREAS,
                        "Key": av({"id_usuario": user_id, "id_tarea": id_tarea}),
                        "UpdateExpression": expresion,
                        "ConditionExpression": (
                            "attribute_exists(id_usuario) AND attribute_exists(id_tarea) "
                            "AND #estado = :pendiente AND #fm = :version"
                        ),
                        "ExpressionAttributeNames": nombres,
                        "ExpressionAttributeValues": av(valores),
                    }
                }
            )

        operaciones.append(
            {
                "Update": {
                    "TableName": TABLA_PROPUESTAS,
                    "Key": av({"id_usuario": user_id, "id_propuesta": id_propuesta}),
                    "UpdateExpression": "SET #s = :aceptada, fecha_resolucion = :ahora",
                    "ConditionExpression": "#s = :pendiente AND attribute_not_exists(id_siguiente)",
                    "ExpressionAttributeNames": {"#s": "status"},
                    "ExpressionAttributeValues": av(
                        {
                            ":aceptada": "aceptada",
                            ":pendiente": "pendiente",
                            ":ahora": ahora,
                        }
                    ),
                }
            }
        )

        cliente.transact_write_items(TransactItems=operaciones)
        return responder(
            200,
            {
                "mensaje": "Cambios aplicados correctamente",
                "id_propuesta": id_propuesta,
                "status": "aceptada",
                "cantidad_acciones": len(acciones),
                "ids_tareas_creadas": ids_creados,
            },
        )

    except ValueError as e:
        print(f"Propuesta inválida: {e}")
        return responder(409, {"error": "La propuesta contiene datos no válidos"})
    except ClientError as e:
        codigo = e.response["Error"]["Code"]
        print(f"Error DynamoDB: {codigo}")
        if codigo in {"TransactionCanceledException", "TransactionConflictException"}:
            return responder(
                409,
                {"error": "Las tareas o la propuesta cambiaron; vuelve a consultar"},
            )
        return responder(500, {"error": "No se pudieron aplicar los cambios"})
    except Exception as e:
        print(f"Error inesperado: {type(e).__name__}: {e}")
        return responder(500, {"error": "Error interno del servidor"})
