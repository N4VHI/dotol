import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
import ulid
from botocore.exceptions import ClientError


dynamodb = boto3.resource("dynamodb")
tabla = dynamodb.Table(os.environ["TABLA_TAREAS"])


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(datos),
    }


def validar_fecha(fecha):
    if not isinstance(fecha, str):
        return False

    try:
        fecha_obj = datetime.fromisoformat(fecha)
        return fecha_obj.utcoffset() is not None
    except ValueError:
        return False


def lambda_handler(event, context):
    try:
        # 1. Obtener el usuario autenticado
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]

        # 2. Leer el JSON recibido
        try:
            datos = json.loads(event.get("body") or "{}")
        except (json.JSONDecodeError, TypeError):
            return responder(400, {"error": "JSON inválido"})

        if not isinstance(datos, dict):
            return responder(400, {"error": "Se esperaba un objeto JSON"})

        # 3. Obtener campos de la tarea
        nombre = datos.get("nombre")
        descripcion = datos.get("descripcion")
        categoria = datos.get("categoria")
        fecha_hacer = datos.get("fecha_hacer")

        # 4. Validar nombre obligatorio
        if not isinstance(nombre, str) or not nombre.strip():
            return responder(400, {"error": "El nombre es obligatorio"})

        nombre = nombre.strip()

        if len(nombre) > 100:
            return responder(400, {"error": "El nombre supera 100 caracteres"})

        # 5. Validar descripción opcional
        if descripcion is not None:
            if not isinstance(descripcion, str) or len(descripcion) > 500:
                return responder(400, {"error": "Descripción inválida"})
            descripcion = descripcion.strip()

        # 6. Validar categoría opcional
        if categoria is not None:
            if not isinstance(categoria, str):
                return responder(400, {"error": "Categoría inválida"})

        # 7. Validar fecha opcional
        if fecha_hacer is not None and not validar_fecha(fecha_hacer):
            return responder(
                400, {"error": "fecha_hacer debe ser ISO 8601 con zona horaria"}
            )

        # 8. Generar campos automáticos
        id_tarea = str(ulid.new())
        ahora = datetime.now(timezone.utc).isoformat()

        # 9. Construir el registro DynamoDB
        tarea = {
            "id_usuario": user_id,
            "id_tarea": id_tarea,
            "nombre": nombre,
            "fecha_creacion": ahora,
            "fecha_modificacion": ahora,
            "creada_por_ia": False,
            "estado": "pendiente",
        }

        # Agregar campos opcionales solo si existen
        if descripcion is not None:
            tarea["descripcion"] = descripcion

        if categoria is not None:
            tarea["categoria"] = categoria

        if fecha_hacer is not None:
            tarea["fecha_hacer"] = fecha_hacer

        # 10. Guardar en DynamoDB
        tabla.put_item(
            Item=tarea,
            ConditionExpression=(
                "attribute_not_exists(id_usuario) AND attribute_not_exists(id_tarea)"
            ),
        )

        # 11. Responder al frontend
        return responder(
            201, {"mensaje": "Tarea registrada correctamente", "tarea": tarea}
        )

    except ClientError as e:
        print(f"Error DynamoDB: {e.response['Error']['Code']}")
        return responder(500, {"error": "No se pudo registrar la tarea"})

    except Exception as e:
        print(f"Error inesperado: {str(e)}")
        return responder(500, {"error": "Error interno del servidor"})
