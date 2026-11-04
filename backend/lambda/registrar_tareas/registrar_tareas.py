import json
import os
import re

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import boto3
import ulid
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError


# Configuración
dynamodb = boto3.resource("dynamodb")
cliente = boto3.client("dynamodb")

TABLA_TAREAS = os.environ["TABLA_TAREAS"]
TABLA_CATEGORIAS = os.environ["TABLA_CATEGORIAS"]

categorias_table = dynamodb.Table(TABLA_CATEGORIAS)

serializador = TypeSerializer()
ZONA = ZoneInfo("America/Lima")


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(datos, ensure_ascii=False),
    }


def validar_fecha_hacer(fecha, ahora_utc):
    if not isinstance(fecha, str):
        return None

    try:
        fecha_obj = datetime.fromisoformat(fecha)

        if fecha_obj.utcoffset() is None:
            return None

        if fecha_obj <= ahora_utc:
            return None

        return fecha_obj

    except ValueError:
        return None


def validar_fecha_dia(fecha, hoy):
    if not isinstance(fecha, str):
        return False

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha):
        return False

    try:
        fecha_obj = date.fromisoformat(fecha)
        return fecha_obj >= hoy
    except ValueError:
        return False


def obtener_categoria(user_id, id_categoria):
    resultado = categorias_table.get_item(
        Key={"id_usuario": user_id, "id_categoria": id_categoria}, ConsistentRead=True
    )

    return resultado.get("Item")


def serializar_item(item):
    return {clave: serializador.serialize(valor) for clave, valor in item.items()}


def lambda_handler(event, context):
    try:
        # 1. Usuario autenticado
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]

        # 2. Leer JSON
        try:
            datos = json.loads(event.get("body") or "{}")
        except (json.JSONDecodeError, TypeError):
            return responder(400, {"error": "JSON inválido"})

        if not isinstance(datos, dict):
            return responder(400, {"error": "Se esperaba un objeto JSON"})

        # 3. Validar campos permitidos
        campos_permitidos = {
            "nombre",
            "descripcion",
            "id_categoria",
            "fecha_hacer",
            "fecha_dia",
        }

        campos_invalidos = set(datos) - campos_permitidos

        if campos_invalidos:
            return responder(
                400,
                {"error": "Campos no permitidos", "campos": sorted(campos_invalidos)},
            )

        # 4. Obtener campos
        nombre = datos.get("nombre")
        descripcion = datos.get("descripcion")
        id_categoria = datos.get("id_categoria")
        fecha_hacer = datos.get("fecha_hacer")
        fecha_dia = datos.get("fecha_dia")

        # 5. Validar nombre
        if not isinstance(nombre, str) or not nombre.strip():
            return responder(400, {"error": "El nombre es obligatorio"})

        nombre = nombre.strip()

        if len(nombre) > 100:
            return responder(400, {"error": "El nombre supera 100 caracteres"})

        # 6. Validar descripción
        if descripcion is not None:
            if not isinstance(descripcion, str) or len(descripcion) > 500:
                return responder(400, {"error": "Descripción inválida"})

            descripcion = descripcion.strip()

        # 7. Validar categoría
        categoria = None

        if id_categoria is not None:
            if not isinstance(id_categoria, str) or not re.fullmatch(
                r"[0-9A-HJKMNP-TV-Z]{26}", id_categoria
            ):
                return responder(400, {"error": "ID de categoría inválido"})

            categoria = obtener_categoria(user_id, id_categoria)

            if not categoria:
                return responder(
                    400, {"error": "La categoría no existe o no pertenece al usuario"}
                )

        # 8. Obtener momento actual
        ahora_utc = datetime.now(timezone.utc)
        hoy_local = ahora_utc.astimezone(ZONA).date()

        # 9. Validar campos de fecha
        if "fecha_hacer" in datos and "fecha_dia" in datos:
            return responder(400, {"error": "Envía fecha_hacer o fecha_dia, no ambos"})

        fecha_obj = None

        if fecha_hacer is not None:
            fecha_obj = validar_fecha_hacer(fecha_hacer, ahora_utc)

            if fecha_obj is None:
                return responder(
                    400,
                    {
                        "error": (
                            "fecha_hacer debe tener formato ISO 8601 "
                            "con zona horaria y ser futura"
                        )
                    },
                )

        if fecha_dia is not None:
            if not validar_fecha_dia(fecha_dia, hoy_local):
                return responder(
                    400,
                    {
                        "error": (
                            "fecha_dia debe tener formato YYYY-MM-DD "
                            "y ser igual o posterior a hoy"
                        )
                    },
                )

        # 10. Generar campos automáticos
        ahora = ahora_utc.isoformat()
        id_tarea = str(ulid.new())

        tarea = {
            "id_usuario": user_id,
            "id_tarea": id_tarea,
            "nombre": nombre,
            "fecha_creacion": ahora,
            "fecha_modificacion": ahora,
            "creada_por_ia": False,
            "estado": "pendiente",
        }

        # 11. Agregar atributos opcionales
        if descripcion is not None:
            tarea["descripcion"] = descripcion

        if categoria is not None:
            tarea["id_categoria"] = id_categoria
            tarea["categoria"] = categoria["nombre"]

        if fecha_obj is not None:
            tarea["fecha_hacer"] = fecha_hacer
            tarea["fecha_dia"] = fecha_obj.astimezone(ZONA).date().isoformat()

        elif fecha_dia is not None:
            tarea["fecha_dia"] = fecha_dia

        # 12. Preparar registro transaccional
        operaciones = [
            {
                "Put": {
                    "TableName": TABLA_TAREAS,
                    "Item": serializar_item(tarea),
                    "ConditionExpression": ("attribute_not_exists(id_usuario)"),
                }
            }
        ]

        # Verificar que la categoría siga existiendo
        # al momento de registrar la tarea.
        if categoria is not None:
            operaciones.append(
                {
                    "ConditionCheck": {
                        "TableName": TABLA_CATEGORIAS,
                        "Key": serializar_item(
                            {"id_usuario": user_id, "id_categoria": id_categoria}
                        ),
                        "ConditionExpression": (
                            "attribute_exists(id_usuario) "
                            "AND attribute_exists(id_categoria) "
                            "AND #nombre = :nombre"
                        ),
                        "ExpressionAttributeNames": {"#nombre": "nombre"},
                        "ExpressionAttributeValues": {
                            ":nombre": {"S": categoria["nombre"]}
                        },
                    }
                }
            )

        # 13. Guardar en DynamoDB
        cliente.transact_write_items(TransactItems=operaciones)

        # 14. Responder
        return responder(
            201, {"mensaje": "Tarea registrada correctamente", "tarea": tarea}
        )

    except ClientError as e:
        codigo = e.response["Error"]["Code"]

        if codigo == "TransactionCanceledException":
            return responder(
                409,
                {
                    "error": (
                        "No se pudo completar el registro. "
                        "Verifica que la categoría siga disponible "
                        "e inténtalo nuevamente."
                    )
                },
            )

        print(f"Error DynamoDB: {codigo}")

        return responder(500, {"error": "No se pudo registrar la tarea"})

    except Exception as e:
        print(f"Error inesperado: {type(e).__name__}: {str(e)}")

        return responder(500, {"error": "Error interno del servidor"})
