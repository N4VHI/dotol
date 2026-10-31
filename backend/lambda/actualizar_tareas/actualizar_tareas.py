import json
import os

from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


# Cliente DynamoDB reutilizable
dynamodb = boto3.resource("dynamodb")
tabla = dynamodb.Table(os.environ["TABLA_TAREAS"])


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(datos, ensure_ascii=False),
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

        # 2. Obtener el identificador desde la URL
        parametros = event.get("pathParameters") or {}
        id_tarea = parametros.get("id_tarea")

        if not id_tarea:
            return responder(400, {"error": "El ID de la tarea es obligatorio"})

        # 3. Leer y validar el JSON
        try:
            datos = json.loads(event.get("body") or "{}")
        except (json.JSONDecodeError, TypeError):
            return responder(400, {"error": "JSON inválido"})

        if not isinstance(datos, dict):
            return responder(400, {"error": "Se esperaba un objeto JSON"})

        # 4. Definir atributos permitidos
        campos_permitidos = {"nombre", "descripcion", "categoria", "fecha_hacer"}

        campos_recibidos = set(datos.keys())

        if not campos_recibidos:
            return responder(400, {"error": "No se enviaron campos para actualizar"})

        campos_invalidos = campos_recibidos - campos_permitidos

        if campos_invalidos:
            return responder(
                400,
                {"error": "Campos no permitidos", "campos": sorted(campos_invalidos)},
            )

        # 5. Validar nombre
        if "nombre" in datos:
            nombre = datos["nombre"]

            if not isinstance(nombre, str) or not nombre.strip():
                return responder(400, {"error": "El nombre no puede estar vacío"})

            nombre = nombre.strip()

            if len(nombre) > 100:
                return responder(400, {"error": "El nombre supera 100 caracteres"})

            datos["nombre"] = nombre

        # 6. Validar descripción
        if "descripcion" in datos:
            descripcion = datos["descripcion"]

            if descripcion is not None:
                if not isinstance(descripcion, str):
                    return responder(400, {"error": "Descripción inválida"})

                if len(descripcion) > 500:
                    return responder(
                        400, {"error": "La descripción supera 500 caracteres"}
                    )

                datos["descripcion"] = descripcion.strip()

        # 7. Validar categoría
        if "categoria" in datos:
            categoria = datos["categoria"]

        # 8. Validar fecha
        if "fecha_hacer" in datos:
            fecha = datos["fecha_hacer"]

            if fecha is not None and not validar_fecha(fecha):
                return responder(
                    400, {"error": "Fecha inválida. Se requiere ISO 8601 con offset"}
                )

        # 9. Construir expresión de actualización
        expresiones_set = []
        expresiones_remove = []
        nombres = {}
        valores = {}

        for indice, (campo, valor) in enumerate(datos.items()):
            nombre_alias = f"#campo{indice}"

            nombres[nombre_alias] = campo

            if valor is None:
                # null elimina un atributo opcional
                expresiones_remove.append(nombre_alias)
            else:
                valor_alias = f":valor{indice}"
                valores[valor_alias] = valor
                expresiones_set.append(f"{nombre_alias} = {valor_alias}")

        # 10. Actualizar fecha de modificación
        ahora = datetime.now(timezone.utc).isoformat()

        nombres["#fecha_modificacion"] = "fecha_modificacion"
        valores[":ahora"] = ahora

        expresiones_set.append("#fecha_modificacion = :ahora")

        expresion = "SET " + ", ".join(expresiones_set)

        if expresiones_remove:
            expresion += " REMOVE " + ", ".join(expresiones_remove)

        # 11. Ejecutar actualización condicional
        resultado = tabla.update_item(
            Key={"id_usuario": user_id, "id_tarea": id_tarea},
            UpdateExpression=expresion,
            ConditionExpression=(
                "attribute_exists(id_usuario) "
                "AND attribute_exists(id_tarea) "
                "AND #estado <> :eliminada"
            ),
            ExpressionAttributeNames={**nombres, "#estado": "estado"},
            ExpressionAttributeValues={**valores, ":eliminada": "eliminada"},
            ReturnValues="ALL_NEW",
        )

        # 12. Devolver tarea actualizada
        return responder(
            200,
            {
                "mensaje": "Tarea actualizada correctamente",
                "tarea": resultado["Attributes"],
            },
        )

    except ClientError as e:
        codigo = e.response["Error"]["Code"]

        if codigo == "ConditionalCheckFailedException":
            return responder(404, {"error": "Tarea no encontrada o eliminada"})

        print(f"Error DynamoDB: {codigo}")

        return responder(500, {"error": "No se pudo actualizar la tarea"})

    except Exception as e:
        print(f"Error inesperado: {str(e)}")

        return responder(500, {"error": "Error interno del servidor"})
