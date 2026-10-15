import json


def lambda_handler(event, context):
    try:
        claims = (
            event.get("requestContext", {})
            .get("authorizer", {})
            .get("jwt", {})
            .get("claims", {})
        )

        sub = claims.get("sub")

        if not sub:
            return {
                "statusCode": 401,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"error": "Authenticated user not found"}),
            }

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"message": "Welcome to TODOL!", "user_id": sub}),
        }

    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        raise
