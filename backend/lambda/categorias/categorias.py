import json
import os
import unicodedata
from datetime import datetime, timezone

import boto3
import ulid
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

TABLA = os.environ["TABLA_CATEGORIAS"]
MAX_CATEGORIAS = 10
META_ID = "__META__"

categoria_table = boto3.resource("dynamodb").Table(TABLA)
dynamodb = boto3.client("dynamodb")
serializer = TypeSerializer()

CATEGORIAS_INICIALES = [
    (
        "Responsabilidades",
        "Actividades que ayudan a mantener el orden y el funcionamiento de tu vida cotidiana",
    ),
    (
        "Salud",
        "Acciones orientadas a cuidar tanto el bienestar físico como psicológico",
    ),
    (
        "Intereses y tiempo libre",
        "Actividades que se disfrutan y se hacen por gusto, curiosidad o recreación",
    ),
    (
        "Trabajo o estudios",
        "Acciones relacionadas con responsabilidades laborales o académicas",
    ),
    (
        "Relaciones Sociales",
        "Acciones orientadas a fortalecer vínculos con otras personas, como amigos, familia o pareja",
    ),
]


def responder(status, datos):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(datos, ensure_ascii=False),
    }


def ddb_item(item):
    return {clave: serializer.serialize(valor) for clave, valor in item.items()}


def clave_meta(user_id):
    return {"id_usuario": user_id, "id_categoria": META_ID}


def inicializar_si_falta(user_id):
    meta = categoria_table.get_item(Key=clave_meta(user_id), ConsistentRead=True).get(
        "Item"
    )
    if meta:
        return

    ahora = datetime.now(timezone.utc).isoformat()
    items = [
        {
            "id_usuario": user_id,
            "id_categoria": META_ID,
            "cantidad": len(CATEGORIAS_INICIALES),
        }
    ]

    for nombre, descripcion in CATEGORIAS_INICIALES:
        items.append(
            {
                "id_usuario": user_id,
                "id_categoria": str(ulid.new()),
                "nombre": nombre,
                "descripcion": descripcion,
                "predeterminada": True,
                "fecha_creacion": ahora,
            }
        )

    transacciones = [
        {
            "Put": {
                "TableName": TABLA,
                "Item": ddb_item(item),
                "ConditionExpression": "attribute_not_exists(id_usuario) AND attribute_not_exists(id_categoria)",
            }
        }
        for item in items
    ]

    try:
        dynamodb.transact_write_items(TransactItems=transacciones)
    except ClientError as e:
        if e.response["Error"]["Code"] == "TransactionCanceledException":
            # Otra petición pudo haber completado el registro inicial.
            meta = categoria_table.get_item(
                Key=clave_meta(user_id), ConsistentRead=True
            ).get("Item")
            if meta:
                return
        raise


def consultar_categorias(user_id):
    # Máximo 10 categorías reales y un registro de metadatos.
    respuesta = categoria_table.query(
        KeyConditionExpression=Key("id_usuario").eq(user_id),
        ConsistentRead=True,
    )
    items = respuesta.get("Items", [])
    meta = next((x for x in items if x["id_categoria"] == META_ID), None)
    categorias = [x for x in items if x["id_categoria"] != META_ID]
    categorias.sort(key=lambda x: x["nombre"].casefold())
    return categorias, int(meta["cantidad"]) if meta else 0


def normalizar_nombre(nombre):
    return unicodedata.normalize("NFKC", " ".join(nombre.split())).casefold()


def lambda_handler(event, context):
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        user_id = claims["sub"]
        metodo = event["requestContext"]["http"]["method"].upper()

        inicializar_si_falta(user_id)

        if metodo == "GET":
            categorias, cantidad = consultar_categorias(user_id)
            return responder(
                200,
                {
                    "categorias": categorias,
                    "cantidad": cantidad,
                    "limite": MAX_CATEGORIAS,
                },
            )

        if metodo == "POST":
            try:
                datos = json.loads(event.get("body") or "{}")
            except (TypeError, json.JSONDecodeError):
                return responder(400, {"error": "JSON inválido"})

            if not isinstance(datos, dict) or set(datos) - {"nombre", "descripcion"}:
                return responder(400, {"error": "Campos no permitidos"})

            nombre = datos.get("nombre")
            descripcion = datos.get("descripcion", "")
            if not isinstance(nombre, str) or not 1 <= len(nombre.strip()) <= 50:
                return responder(
                    400, {"error": "Nombre obligatorio (máximo 50 caracteres)"}
                )
            if not isinstance(descripcion, str) or len(descripcion.strip()) > 250:
                return responder(
                    400, {"error": "Descripción inválida (máximo 250 caracteres)"}
                )

            nombre = " ".join(nombre.split())
            descripcion = descripcion.strip()

            existentes, _ = consultar_categorias(user_id)
            if any(
                normalizar_nombre(c["nombre"]) == normalizar_nombre(nombre)
                for c in existentes
            ):
                return responder(
                    409, {"error": "Ya existe una categoría con ese nombre"}
                )

            nueva = {
                "id_usuario": user_id,
                "id_categoria": str(ulid.new()),
                "nombre": nombre,
                "descripcion": descripcion,
                "predeterminada": False,
                "fecha_creacion": datetime.now(timezone.utc).isoformat(),
            }
            try:
                dynamodb.transact_write_items(
                    TransactItems=[
                        {
                            "Update": {
                                "TableName": TABLA,
                                "Key": ddb_item(clave_meta(user_id)),
                                "UpdateExpression": "SET cantidad = cantidad + :uno",
                                "ConditionExpression": "attribute_exists(id_categoria) AND cantidad < :max",
                                "ExpressionAttributeValues": {
                                    ":uno": {"N": "1"},
                                    ":max": {"N": str(MAX_CATEGORIAS)},
                                },
                            }
                        },
                        {
                            "Put": {
                                "TableName": TABLA,
                                "Item": ddb_item(nueva),
                                "ConditionExpression": "attribute_not_exists(id_usuario) AND attribute_not_exists(id_categoria)",
                            }
                        },
                    ]
                )
            except ClientError as e:
                if e.response["Error"]["Code"] == "TransactionCanceledException":
                    return responder(
                        409,
                        {"error": "Límite de 10 categorías o conflicto concurrente"},
                    )
                raise
            return responder(201, {"categoria": nueva})

        if metodo == "DELETE":
            id_categoria = (event.get("pathParameters") or {}).get("id_categoria")
            if not id_categoria or id_categoria == META_ID:
                return responder(400, {"error": "ID de categoría inválido"})

            try:
                dynamodb.transact_write_items(
                    TransactItems=[
                        {
                            "Delete": {
                                "TableName": TABLA,
                                "Key": ddb_item(
                                    {
                                        "id_usuario": user_id,
                                        "id_categoria": id_categoria,
                                    }
                                ),
                                "ConditionExpression": "attribute_exists(id_categoria)",
                            }
                        },
                        {
                            "Update": {
                                "TableName": TABLA,
                                "Key": ddb_item(clave_meta(user_id)),
                                "UpdateExpression": "SET cantidad = cantidad - :uno",
                                "ConditionExpression": "attribute_exists(id_categoria) AND cantidad > :cero",
                                "ExpressionAttributeValues": {
                                    ":uno": {"N": "1"},
                                    ":cero": {"N": "0"},
                                },
                            }
                        },
                    ]
                )
            except ClientError as e:
                if e.response["Error"]["Code"] == "TransactionCanceledException":
                    return responder(
                        404, {"error": "Categoría inexistente o ya eliminada"}
                    )
                raise

            return responder(
                200, {"mensaje": "Categoría eliminada", "id_categoria": id_categoria}
            )

        return responder(405, {"error": "Método no permitido"})

    except ClientError as e:
        print("Error DynamoDB:", e.response["Error"]["Code"])
        return responder(500, {"error": "Error al gestionar categorías"})
    except Exception as e:
        print("Error inesperado:", type(e).__name__)
        return responder(500, {"error": "Error interno"})
