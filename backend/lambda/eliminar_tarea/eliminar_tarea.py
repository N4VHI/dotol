import json
import os

from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


# Inicializar DynamoDB
dynamodb = boto3.resource("dynamodb")
tabla = dynamodb.Table(os.environ["TABLA_TAREAS"])


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(datos, ensure_ascii=False),
    }


def lambda_handler(event, context):
    try:
        # 1. Obtener usuario autenticado
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]

        # 2. Obtener ID de la tarea
        parametros = event.get("pathParameters") or {}
        id_tarea = parametros.get("id_tarea")

        if not id_tarea:
            return responder(400, {"error": "El ID de la tarea es obligatorio"})

        # 3. Obtener fecha actual en UTC
        ahora = datetime.now(timezone.utc).isoformat()

        # 4. Actualizar la tarea
        resultado = tabla.update_item(
            Key={"id_usuario": user_id, "id_tarea": id_tarea},
            UpdateExpression=("SET #estado = :eliminada, #fecha_modificacion = :ahora"),
            ConditionExpression=(
                "attribute_exists(id_usuario) "
                "AND attribute_exists(id_tarea) "
                "AND #estado <> :eliminada"
            ),
            ExpressionAttributeNames={
                "#estado": "estado",
                "#fecha_modificacion": "fecha_modificacion",
            },
            ExpressionAttributeValues={
                ":eliminada": "eliminada",
                ":ahora": ahora,
            },
            ReturnValues="ALL_NEW",
        )

        # 5. Responder con la tarea actualizada
        return responder(
            200,
            {
                "mensaje": "Tarea eliminada correctamente",
                "tarea": resultado["Attributes"],
            },
        )

    except ClientError as e:
        codigo = e.response["Error"]["Code"]

        if codigo == "ConditionalCheckFailedException":
            return responder(
                409,
                {
                    "error": (
                        "No se pudo eliminar la tarea. "
                        "Puede que no exista o que ya esté eliminada."
                    )
                },
            )

        print(f"Error DynamoDB: {codigo}")

        return responder(500, {"error": "No se pudo eliminar la tarea"})

    except Exception as e:
        print(f"Error inesperado: {str(e)}")

        return responder(500, {"error": "Error interno del servidor"})
