import json
import os


def lambda_handler(event, context):
    print(json.dumps(event))  # para ver el evento completo en los logs
    # sub = ...                     # ver abajo
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({...}),
    }
