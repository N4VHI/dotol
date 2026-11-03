import json
import os
import re

from datetime import datetime, date, timezone

import boto3
from botocore.exceptions import ClientError


# Cliente DynamoDB reutilizable
dynamodb = boto3.resource("dynamodb")
tabla = dynamodb.Table(os.environ["TABLA_TAREAS"])


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(datos, ensure_ascii=False),
    }


def validar_fecha_hacer(fecha):
    if not isinstance(fecha, str):
        return False

    try:
        fecha_obj = datetime.fromisoformat(fecha)
        return fecha_obj.utcoffset() is not None
    except ValueError:
        return False


def validar_fecha_dia(fecha):
    if not isinstance(fecha, str):
        return False

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha):
        return False

    try:
        fecha_obj = date.fromisoformat(fecha)
        return fecha_obj.isoformat() == fecha
    except ValueError:
        return False


def lambda_handler(event, context):
    try:
        # 1. Obtener usuario autenticado
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]

        # 2. Obtener identificador de la tarea
        parametros = event.get("pathParameters") or {}
        id_tarea = parametros.get("id_tarea")

        if not id_tarea:
            return responder(400, {"error": "El ID de la tarea es obligatorio"})

        # 3. Leer JSON
        try:
            datos = json.loads(event.get("body") or "{}")
        except (json.JSONDecodeError, TypeError):
            return responder(400, {"error": "JSON inválido"})

        if not isinstance(datos, dict):
            return responder(400, {"error": "Se esperaba un objeto JSON"})

        # 4. Validar campos permitidos
        campos_permitidos = {
            "nombre",
            "descripcion",
            "categoria",
            "fecha_hacer",
            "fecha_dia",
        }

        if not datos:
            return responder(400, {"error": "No se enviaron campos para actualizar"})

        campos_invalidos = set(datos) - campos_permitidos

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

            # Ajustar según las categorías oficiales de dotol
            categorias_validas = {"academica", "personal", "otra"}

            if categoria is not None and (
                not isinstance(categoria, str) or categoria not in categorias_validas
            ):
                return responder(400, {"error": "Categoría no permitida"})

        # 8. Validar y sincronizar fechas

        # Evitar dos fuentes de fecha en una solicitud
        if "fecha_hacer" in datos and "fecha_dia" in datos:
            return responder(
                400, {"error": ("Envía fecha_hacer o fecha_dia, pero no ambos")}
            )

        if "fecha_hacer" in datos:
            fecha_hacer = datos["fecha_hacer"]

            if fecha_hacer is None:
                # El usuario quita la fecha y hora
                datos["fecha_dia"] = None

            else:
                if not validar_fecha_hacer(fecha_hacer):
                    return responder(
                        400,
                        {"error": ("fecha_hacer debe ser ISO 8601 con hora y offset")},
                    )

                fecha_obj = datetime.fromisoformat(fecha_hacer)

                # Sincronizar fecha calendario
                datos["fecha_dia"] = fecha_obj.date().isoformat()

        elif "fecha_dia" in datos:
            fecha_dia = datos["fecha_dia"]

            if fecha_dia is not None:
                if not validar_fecha_dia(fecha_dia):
                    return responder(400, {"error": ("fecha_dia debe usar YYYY-MM-DD")})

            # El usuario eligió un día sin hora,
            # o decidió eliminar la fecha.
            datos["fecha_hacer"] = None

        # 9. Construir expresión DynamoDB
        expresiones_set = []
        expresiones_remove = []
        nombres = {}
        valores = {}

        for indice, (campo, valor) in enumerate(datos.items()):
            nombre_alias = f"#campo{indice}"
            nombres[nombre_alias] = campo

            if valor is None:
                # Eliminar atributo opcional
                expresiones_remove.append(nombre_alias)

            else:
                valor_alias = f":valor{indice}"
                valores[valor_alias] = valor

                expresiones_set.append(f"{nombre_alias} = {valor_alias}")

        # 10. Fecha de modificación automática
        ahora = datetime.now(timezone.utc).isoformat()

        nombres["#fecha_modificacion"] = "fecha_modificacion"
        valores[":ahora"] = ahora

        expresiones_set.append("#fecha_modificacion = :ahora")

        expresion = "SET " + ", ".join(expresiones_set)

        if expresiones_remove:
            expresion += " REMOVE " + ", ".join(expresiones_remove)

        # 11. Actualizar DynamoDB
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

        # 12. Responder con tarea actualizada
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
