import json
import os

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


dynamodb = boto3.resource("dynamodb")
tabla = dynamodb.Table(os.environ["TABLA_PROPUESTAS"])


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(datos, ensure_ascii=False),
    }


def consultar_propuestas(user_id):
    # Recuperar las propuestas del usuario,
    # incluyendo todas las páginas de DynamoDB.
    propuestas = []
    ultima_clave = None

    while True:
        parametros = {
            "KeyConditionExpression": Key("id_usuario").eq(user_id),
            "ConsistentRead": True,
            "ScanIndexForward": False,
        }

        if ultima_clave:
            parametros["ExclusiveStartKey"] = ultima_clave

        resultado = tabla.query(**parametros)
        propuestas.extend(resultado.get("Items", []))

        ultima_clave = resultado.get("LastEvaluatedKey")

        if not ultima_clave:
            break

    return propuestas


def lambda_handler(event, context):
    try:
        # 1. Identificar usuario autenticado
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]

        # 2. Consultar propuestas del usuario
        propuestas = consultar_propuestas(user_id)

        # 3. Buscar propuesta activa
        pendientes = [
            p
            for p in propuestas
            if p.get("status") == "pendiente" and not p.get("id_siguiente")
        ]

        # Verificar consistencia del sistema
        if len(pendientes) > 1:
            print("Error: existen varios hilos o propuestas pendientes")
            return responder(
                409, {"error": "Se encontraron varias propuestas pendientes"}
            )

        # 4. Si no hay hilo activo, devolver chat vacío
        if not pendientes:
            return responder(
                200,
                {
                    "id_hilo": None,
                    "id_propuesta_actual": None,
                    "mensajes": [],
                    "acciones": [],
                    "status": "sin_hilo",
                },
            )

        propuesta_actual = pendientes[0]
        id_hilo = propuesta_actual["id_hilo"]

        # 5. Recuperar todas las propuestas del mismo hilo
        propuestas_hilo = [p for p in propuestas if p.get("id_hilo") == id_hilo]

        # 6. Orden cronológico
        propuestas_hilo.sort(key=lambda p: p["id_propuesta"])

        # 7. Reconstruir mensajes del chat
        mensajes = []

        for p in propuestas_hilo:
            mensajes.append(
                {
                    "id_propuesta": p["id_propuesta"],
                    "mensaje_usuario": p.get("mensaje_usuario", ""),
                    "respuesta_bot": p.get("respuesta_bot", ""),
                    "fecha_creacion": p.get("fecha_creacion"),
                }
            )

        # 8. Obtener SOLO las últimas acciones
        acciones_actuales = propuesta_actual.get("acciones", [])

        # 9. Devolver estado del chat
        return responder(
            200,
            {
                "id_hilo": id_hilo,
                "id_propuesta_actual": propuesta_actual["id_propuesta"],
                "mensajes": mensajes,
                "acciones": acciones_actuales,
                "status": "pendiente",
            },
        )

    except ClientError as e:
        codigo = e.response["Error"]["Code"]
        print(f"Error DynamoDB: {codigo}")

        return responder(500, {"error": "No se pudo recuperar el chat"})

    except Exception as e:
        print(f"Error inesperado: {type(e).__name__}")

        return responder(500, {"error": "Error interno del servidor"})
