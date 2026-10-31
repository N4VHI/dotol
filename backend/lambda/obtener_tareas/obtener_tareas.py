import json
import boto3
import os
from boto3.dynamodb.conditions import Key, Attr

dynamodb = boto3.resource("dynamodb")
tabla = dynamodb.Table(os.environ["TABLA_TAREAS"])


def lambda_handler(event, context):
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]

        resultado = tabla.query(
            KeyConditionExpression=Key("id_usuario").eq(user_id),
            FilterExpression=Attr("estado").ne("eliminada"),
        )

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(resultado["Items"]),
        }

    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        raise
