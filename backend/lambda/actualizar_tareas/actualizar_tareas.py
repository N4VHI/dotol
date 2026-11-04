import json
import os
import re

from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError


# 1. Configuración
dynamodb = boto3.resource("dynamodb")
cliente = boto3.client("dynamodb")

TABLA_TAREAS = os.environ["TABLA_TAREAS"]
TABLA_CATEGORIAS = os.environ["TABLA_CATEGORIAS"]

tabla_tareas = dynamodb.Table(TABLA_TAREAS)
tabla_categorias = dynamodb.Table(TABLA_CATEGORIAS)

serializador = TypeSerializer()
ZONA = ZoneInfo("America/Lima")


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(datos, ensure_ascii=False),
    }


def serializar_item(item):
    return {clave: serializador.serialize(valor) for clave, valor in item.items()}


# 2. Validaciones de fechas
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


def validar_fecha_dia(fecha, hoy_local):
    if not isinstance(fecha, str):
        return False

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha):
        return False

    try:
        fecha_obj = date.fromisoformat(fecha)
        return fecha_obj >= hoy_local
    except ValueError:
        return False


# 3. Consultar categoría del usuario
def obtener_categoria(user_id, id_categoria):
    resultado = tabla_categorias.get_item(
        Key={"id_usuario": user_id, "id_categoria": id_categoria}, ConsistentRead=True
    )

    return resultado.get("Item")


def lambda_handler(event, context):
    try:
        # 4. Obtener usuario autenticado
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]

        # 5. Obtener ID de la tarea
        parametros = event.get("pathParameters") or {}
        id_tarea = parametros.get("id_tarea")

        if not id_tarea:
            return responder(400, {"error": "El ID de la tarea es obligatorio"})

        clave_tarea = {"id_usuario": user_id, "id_tarea": id_tarea}

        # 6. Leer JSON
        try:
            datos = json.loads(event.get("body") or "{}")
        except (json.JSONDecodeError, TypeError):
            return responder(400, {"error": "JSON inválido"})

        if not isinstance(datos, dict):
            return responder(400, {"error": "Se esperaba un objeto JSON"})

        # 7. Validar campos permitidos
        campos_permitidos = {
            "nombre",
            "descripcion",
            "id_categoria",
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

        # 8. Validar nombre
        if "nombre" in datos:
            nombre = datos["nombre"]

            if not isinstance(nombre, str) or not nombre.strip():
                return responder(400, {"error": "El nombre no puede estar vacío"})

            nombre = nombre.strip()

            if len(nombre) > 100:
                return responder(400, {"error": "El nombre supera 100 caracteres"})

            datos["nombre"] = nombre

        # 9. Validar descripción
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

        # 10. Validar categoría
        categoria = None
        id_categoria = datos.get("id_categoria")

        if "id_categoria" in datos:
            if id_categoria is None:
                # Eliminar relación y nombre de categoría
                datos["categoria"] = None

            else:
                if not isinstance(id_categoria, str) or not re.fullmatch(
                    r"[0-9A-HJKMNP-TV-Z]{26}", id_categoria
                ):
                    return responder(400, {"error": "ID de categoría inválido"})

                categoria = obtener_categoria(user_id, id_categoria)

                if not categoria:
                    return responder(
                        404, {"error": ("Categoría no encontrada para este usuario")}
                    )

                # Guardar nombre real del catálogo
                datos["categoria"] = categoria["nombre"]

        # 11. Obtener fecha actual
        ahora_utc = datetime.now(timezone.utc)
        hoy_local = ahora_utc.astimezone(ZONA).date()

        # 12. Evitar dos tipos de fecha simultáneos
        if "fecha_hacer" in datos and "fecha_dia" in datos:
            return responder(
                400, {"error": ("Envía fecha_hacer o fecha_dia, pero no ambos")}
            )

        # 13. Validar y sincronizar fechas
        if "fecha_hacer" in datos:
            fecha_hacer = datos["fecha_hacer"]

            if fecha_hacer is None:
                datos["fecha_dia"] = None

            else:
                fecha_obj = validar_fecha_hacer(fecha_hacer, ahora_utc)

                if fecha_obj is None:
                    return responder(
                        400,
                        {
                            "error": (
                                "fecha_hacer debe ser ISO 8601 "
                                "con offset y posterior al "
                                "momento actual"
                            )
                        },
                    )

                datos["fecha_dia"] = fecha_obj.astimezone(ZONA).date().isoformat()

        elif "fecha_dia" in datos:
            fecha_dia = datos["fecha_dia"]

            if fecha_dia is not None:
                if not validar_fecha_dia(fecha_dia, hoy_local):
                    return responder(
                        400,
                        {
                            "error": (
                                "fecha_dia debe ser YYYY-MM-DD "
                                "e igual o posterior a hoy"
                            )
                        },
                    )

            # Si se cambia solo el día,
            # se elimina la hora anterior.
            datos["fecha_hacer"] = None

        # 14. Construir expresión de actualización
        expresiones_set = []
        expresiones_remove = []
        nombres = {}
        valores = {}

        for indice, (campo, valor) in enumerate(datos.items()):
            nombre_alias = f"#campo{indice}"
            nombres[nombre_alias] = campo

            if valor is None:
                expresiones_remove.append(nombre_alias)

            else:
                valor_alias = f":valor{indice}"
                valores[valor_alias] = valor

                expresiones_set.append(f"{nombre_alias} = {valor_alias}")

        # 15. Actualizar fecha de modificación
        ahora = datetime.now(timezone.utc).isoformat()

        nombres["#fecha_modificacion"] = "fecha_modificacion"
        valores[":ahora"] = ahora

        expresiones_set.append("#fecha_modificacion = :ahora")

        expresion = "SET " + ", ".join(expresiones_set)

        if expresiones_remove:
            expresion += " REMOVE " + ", ".join(expresiones_remove)

        # 16. Actualización de la tarea
        operacion_tarea = {
            "Update": {
                "TableName": TABLA_TAREAS,
                "Key": serializar_item(clave_tarea),
                "UpdateExpression": expresion,
                "ConditionExpression": (
                    "attribute_exists(id_usuario) "
                    "AND attribute_exists(id_tarea) "
                    "AND #estado <> :eliminada"
                ),
                "ExpressionAttributeNames": {**nombres, "#estado": "estado"},
                "ExpressionAttributeValues": {
                    **serializar_item(valores),
                    ":eliminada": {"S": "eliminada"},
                },
            }
        }

        operaciones = [operacion_tarea]

        # 17. Comprobar existencia de nueva categoría
        if categoria is not None:
            operaciones.append(
                {
                    "ConditionCheck": {
                        "TableName": TABLA_CATEGORIAS,
                        "Key": serializar_item(
                            {"id_usuario": user_id, "id_categoria": id_categoria}
                        ),
                        "ConditionExpression": (
                            "attribute_exists(id_usuario) AND #nombre = :nombre"
                        ),
                        "ExpressionAttributeNames": {"#nombre": "nombre"},
                        "ExpressionAttributeValues": {
                            ":nombre": {"S": categoria["nombre"]}
                        },
                    }
                }
            )

        # 18. Ejecutar actualización atómica
        cliente.transact_write_items(TransactItems=operaciones)

        # 19. Obtener tarea actualizada
        resultado = tabla_tareas.get_item(Key=clave_tarea, ConsistentRead=True)

        tarea_actualizada = resultado.get("Item")

        return responder(
            200,
            {"mensaje": "Tarea actualizada correctamente", "tarea": tarea_actualizada},
        )

    except ClientError as e:
        codigo = e.response["Error"]["Code"]

        if codigo == "TransactionCanceledException":
            razones = e.response.get("CancellationReasons", [])

            if any(razon.get("Code") == "ConditionalCheckFailed" for razon in razones):
                return responder(
                    409,
                    {
                        "error": (
                            "La tarea o categoría ya no está "
                            "disponible para esta operación"
                        )
                    },
                )

            print(f"Transacción cancelada: {razones}")

            return responder(503, {"error": "No se pudo completar la actualización"})

        print(f"Error DynamoDB: {codigo}")

        return responder(500, {"error": "No se pudo actualizar la tarea"})

    except Exception as e:
        print(f"Error inesperado: {type(e).__name__}: {str(e)}")

        return responder(500, {"error": "Error interno del servidor"})
