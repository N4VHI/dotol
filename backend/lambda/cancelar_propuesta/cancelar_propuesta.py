import json
import os

from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


# Inicializar DynamoDB
dynamodb = boto3.resource("dynamodb")
tabla = dynamodb.Table(os.environ["TABLA_PROPUESTAS"])


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(datos, ensure_ascii=False),
    }


def lambda_handler(event, context):
    try:
        # 1. Obtener usuario autenticado
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]

        # 2. Obtener ID de la propuesta
        parametros = event.get("pathParameters") or {}
        id_propuesta = parametros.get("id_propuesta")

        if not id_propuesta:
            return responder(400, {"error": "El ID de la propuesta es obligatorio"})

        clave = {"id_usuario": user_id, "id_propuesta": id_propuesta}

        # 3. Consultar propuesta actual
        resultado = tabla.get_item(Key=clave, ConsistentRead=True)

        propuesta = resultado.get("Item")

        if not propuesta:
            return responder(404, {"error": "Propuesta no encontrada"})

        estado = propuesta.get("status")

        # 4. Si ya fue cancelada, no repetir cambios
        if estado == "cancelada":
            return responder(
                200,
                {
                    "mensaje": "La propuesta ya estaba cancelada",
                    "id_propuesta": id_propuesta,
                    "status": "cancelada",
                },
            )

        # 5. Impedir cancelar propuestas resueltas
        if estado != "pendiente" or propuesta.get("id_siguiente"):
            return responder(
                409,
                {"error": ("No se puede cancelar una propuesta aceptada o continuada")},
            )

        # 6. Generar fecha de resolución
        ahora = datetime.now(timezone.utc).isoformat()

        # 7. Cancelar con actualización condicional
        resultado = tabla.update_item(
            Key=clave,
            UpdateExpression=("SET #status = :cancelada, fecha_resolucion = :ahora"),
            ConditionExpression=(
                "attribute_exists(id_usuario) "
                "AND attribute_exists(id_propuesta) "
                "AND #status = :pendiente "
                "AND attribute_not_exists(id_siguiente)"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":cancelada": "cancelada",
                ":pendiente": "pendiente",
                ":ahora": ahora,
            },
            ReturnValues="UPDATED_NEW",
        )

        # 8. Responder al frontend
        return responder(
            200,
            {
                "mensaje": "Propuesta cancelada correctamente",
                "id_propuesta": id_propuesta,
                "id_hilo": propuesta.get("id_hilo"),
                "status": "cancelada",
                "fecha_resolucion": (resultado["Attributes"]["fecha_resolucion"]),
            },
        )

    except ClientError as e:
        codigo = e.response["Error"]["Code"]

        if codigo == "ConditionalCheckFailedException":
            # Otro request pudo cancelar la propuesta
            # mientras se procesaba esta solicitud.
            try:
                actual = tabla.get_item(Key=clave, ConsistentRead=True).get("Item")

                if actual and actual.get("status") == "cancelada":
                    return responder(
                        200,
                        {
                            "mensaje": "La propuesta ya estaba cancelada",
                            "id_propuesta": id_propuesta,
                            "status": "cancelada",
                        },
                    )
            except ClientError:
                pass

            return responder(
                409, {"error": ("La propuesta cambió de estado y no puede cancelarse")}
            )

        print(f"Error DynamoDB: {codigo}")

        return responder(500, {"error": "No se pudo cancelar la propuesta"})

    except Exception as e:
        print(f"Error inesperado: {type(e).__name__}: {str(e)}")

        return responder(500, {"error": "Error interno del servidor"})
