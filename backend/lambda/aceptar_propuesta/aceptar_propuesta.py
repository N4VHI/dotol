import json
import os
import re
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import boto3
import ulid
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError


TABLA_TAREAS = os.environ["TABLA_TAREAS"]
TABLA_PROPUESTAS = os.environ["TABLA_PROPUESTAS"]
TABLA_CATEGORIAS = os.environ["TABLA_CATEGORIAS"]
ZONA = ZoneInfo(os.environ.get("ZONA_HORARIA", "America/Lima"))
META_CATEGORIAS = "__META__"

PATRON_ULID = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")
PATRON_DIA = re.compile(r"\d{4}-\d{2}-\d{2}")

bd = boto3.resource("dynamodb")
cliente = boto3.client("dynamodb")
tareas = bd.Table(TABLA_TAREAS)
propuestas = bd.Table(TABLA_PROPUESTAS)
categorias = bd.Table(TABLA_CATEGORIAS)
serializador = TypeSerializer()


def av(item):
    """Convierte un dict Python al formato AttributeValue del cliente DynamoDB."""
    return {clave: serializador.serialize(valor) for clave, valor in item.items()}


def responder(status, contenido):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(contenido, ensure_ascii=False),
    }


def validar_fecha(due):
    if due is None:
        return
    if not isinstance(due, str) or not PATRON_DIA.fullmatch(due):
        raise ValueError("La fecha debe tener formato YYYY-MM-DD")
    try:
        dia = date.fromisoformat(due)
    except ValueError as exc:
        raise ValueError("La fecha no existe") from exc
    if dia.isoformat() != due:
        raise ValueError("La fecha debe tener formato YYYY-MM-DD")


def validar_acciones(acciones):
    if not isinstance(acciones, list) or not 1 <= len(acciones) <= 6:
        raise ValueError("La propuesta debe contener entre 1 y 6 acciones")

    ids_usados = set()
    campos = {"op", "id", "title", "due", "category_id"}

    for accion in acciones:
        if not isinstance(accion, dict) or set(accion) != campos:
            raise ValueError("La acción debe contener los cinco campos obligatorios")

        op = accion["op"]
        id_tarea = accion["id"]
        titulo = accion["title"]
        due = accion["due"]
        id_categoria = accion["category_id"]

        if op not in {"create", "update", "delete", "complete"}:
            raise ValueError("Operación no permitida")

        if op == "create":
            if id_tarea is not None:
                raise ValueError("Create no debe tener ID de tarea")
            if id_categoria is not None and (
                not isinstance(id_categoria, str)
                or not PATRON_ULID.fullmatch(id_categoria)
            ):
                raise ValueError("ID de categoría inválido")
        else:
            if not isinstance(id_tarea, str) or not PATRON_ULID.fullmatch(id_tarea):
                raise ValueError("ID de tarea inválido")
            if id_tarea in ids_usados:
                raise ValueError("Hay dos acciones sobre la misma tarea")
            ids_usados.add(id_tarea)
            if op == "update":
                if id_categoria is not None and (
                    not isinstance(id_categoria, str)
                    or not PATRON_ULID.fullmatch(id_categoria)
                ):
                    raise ValueError("ID de categoría inválido en update")
            elif id_categoria is not None:
                raise ValueError("Complete y delete requieren category_id=null")

        if op in {"create", "update"}:
            if not isinstance(titulo, str) or not 1 <= len(titulo.strip()) <= 100:
                raise ValueError("Título inválido")
            validar_fecha(due)
        elif titulo is not None or due is not None:
            raise ValueError("Complete y delete requieren title y due nulos")


def dia_de_tarea(tarea):
    if tarea.get("fecha_dia"):
        return tarea["fecha_dia"]
    if tarea.get("fecha_hacer"):
        instante = datetime.fromisoformat(tarea["fecha_hacer"])
        if instante.utcoffset() is None:
            raise ValueError("Fecha almacenada sin zona horaria")
        return instante.astimezone(ZONA).date().isoformat()
    return None


def cargar_categorias(user_id, acciones):
    """Lee categorías únicas con consistencia fuerte; evita duplicar ConditionCheck."""
    ids_categorias = {
        accion["category_id"]
        for accion in acciones
        if accion["op"] in {"create", "update"} and accion["category_id"] is not None
    }
    categorias_por_id = {}

    for id_categoria in sorted(ids_categorias):
        categoria = categorias.get_item(
            Key={"id_usuario": user_id, "id_categoria": id_categoria},
            ConsistentRead=True,
        ).get("Item")
        if not categoria or not isinstance(categoria.get("nombre"), str):
            return None
        categorias_por_id[id_categoria] = categoria

    return categorias_por_id


def lambda_handler(event, context):
    try:
        # 1. Usuario e identificador de propuesta
        user_id = event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
        id_propuesta = (event.get("pathParameters") or {}).get("id_propuesta")

        if not isinstance(id_propuesta, str) or not PATRON_ULID.fullmatch(id_propuesta):
            return responder(400, {"error": "ID de propuesta inválido"})

        # 2. Consultar propuesta del usuario
        propuesta = propuestas.get_item(
            Key={"id_usuario": user_id, "id_propuesta": id_propuesta},
            ConsistentRead=True,
        ).get("Item")
        if not propuesta:
            return responder(404, {"error": "Propuesta no encontrada"})

        if propuesta.get("status") == "aceptada":
            return responder(
                200,
                {
                    "mensaje": "La propuesta ya fue aceptada",
                    "id_propuesta": id_propuesta,
                    "status": "aceptada",
                },
            )

        if propuesta.get("status") != "pendiente" or "id_siguiente" in propuesta:
            return responder(409, {"error": "La propuesta ya no está vigente"})

        acciones = propuesta.get("acciones")
        if acciones == []:
            return responder(
                409,
                {
                    "error": "La propuesta no tiene acciones; continúa el chat o cancélala"
                },
            )
        validar_acciones(acciones)

        # 3. Recuperar los nombres reales de las categorías seleccionadas
        categorias_por_id = cargar_categorias(user_id, acciones)
        if categorias_por_id is None:
            return responder(
                409, {"error": "Una categoría ya no existe; genera una nueva propuesta"}
            )

        ahora_utc = datetime.now(timezone.utc)
        ahora = ahora_utc.isoformat()
        hoy = ahora_utc.astimezone(ZONA).date()
        operaciones = []
        ids_creados = []
        requiere_catalogo_vacio = False

        # 4. Preparar todas las operaciones sobre tareas
        for accion in acciones:
            op = accion["op"]
            due = accion["due"]

            if op == "create":
                if due is not None and date.fromisoformat(due) < hoy:
                    return responder(
                        409, {"error": "La propuesta contiene una fecha ya vencida"}
                    )

                id_tarea_nueva = str(ulid.new())
                item = {
                    "id_usuario": user_id,
                    "id_tarea": id_tarea_nueva,
                    "nombre": accion["title"].strip(),
                    "estado": "pendiente",
                    "creada_por_ia": True,
                    "id_propuesta": id_propuesta,
                    "fecha_creacion": ahora,
                    "fecha_modificacion": ahora,
                }
                if due is not None:
                    item["fecha_dia"] = due

                id_categoria = accion["category_id"]
                if id_categoria is not None:
                    item["id_categoria"] = id_categoria
                    item["categoria"] = categorias_por_id[id_categoria]["nombre"]
                else:
                    # DeepSeek solo puede asignar null si el catálogo está vacío.
                    requiere_catalogo_vacio = True

                operaciones.append(
                    {
                        "Put": {
                            "TableName": TABLA_TAREAS,
                            "Item": av(item),
                            "ConditionExpression": (
                                "attribute_not_exists(id_usuario) "
                                "AND attribute_not_exists(id_tarea)"
                            ),
                        }
                    }
                )
                ids_creados.append(id_tarea_nueva)
                continue

            # 5. Leer tarea existente y protegerla frente a escrituras concurrentes
            id_tarea = accion["id"]
            existente = tareas.get_item(
                Key={"id_usuario": user_id, "id_tarea": id_tarea},
                ConsistentRead=True,
            ).get("Item")
            if not existente or existente.get("estado") != "pendiente":
                return responder(
                    409,
                    {"error": "Una tarea ya no está pendiente; genera otra propuesta"},
                )

            version = existente.get("fecha_modificacion")
            if not isinstance(version, str) or not version:
                return responder(
                    409, {"error": "La tarea carece de fecha de modificación válida"}
                )

            nombres = {"#estado": "estado", "#fm": "fecha_modificacion"}
            valores = {":pendiente": "pendiente", ":version": version, ":ahora": ahora}
            cambios = ["#fm = :ahora"]
            quitar = []

            if op == "update":
                nombres["#nombre"] = "nombre"
                valores[":nombre"] = accion["title"].strip()
                cambios.append("#nombre = :nombre")

                # Cambiar categoría únicamente cuando el agente devuelve un ID real.
                # Null en update conserva la categoría anterior (no la elimina).
                id_categoria_nueva = accion["category_id"]
                if id_categoria_nueva is not None:
                    nombres["#id_cat"] = "id_categoria"
                    nombres["#cat"] = "categoria"
                    valores[":id_cat"] = id_categoria_nueva
                    valores[":cat"] = categorias_por_id[id_categoria_nueva]["nombre"]
                    cambios.extend(["#id_cat = :id_cat", "#cat = :cat"])

                # Mantener fecha_hacer si solo cambia título/categoría o el día no cambia.
                if due != dia_de_tarea(existente):
                    nombres["#dia"] = "fecha_dia"
                    nombres["#hacer"] = "fecha_hacer"
                    quitar.append("#hacer")
                    if due is None:
                        quitar.append("#dia")
                    else:
                        if date.fromisoformat(due) < hoy:
                            return responder(
                                409,
                                {"error": "La propuesta contiene una fecha ya vencida"},
                            )
                        valores[":dia"] = due
                        cambios.append("#dia = :dia")

            elif op == "complete":
                nombres["#fc"] = "fecha_completada"
                valores[":completada"] = "completada"
                cambios += ["#estado = :completada", "#fc = :ahora"]

            else:  # delete lógico
                valores[":eliminada"] = "eliminada"
                cambios.append("#estado = :eliminada")

            expresion = "SET " + ", ".join(cambios)
            if quitar:
                expresion += " REMOVE " + ", ".join(quitar)

            operaciones.append(
                {
                    "Update": {
                        "TableName": TABLA_TAREAS,
                        "Key": av({"id_usuario": user_id, "id_tarea": id_tarea}),
                        "UpdateExpression": expresion,
                        "ConditionExpression": (
                            "attribute_exists(id_usuario) AND attribute_exists(id_tarea) "
                            "AND #estado = :pendiente AND #fm = :version"
                        ),
                        "ExpressionAttributeNames": nombres,
                        "ExpressionAttributeValues": av(valores),
                    }
                }
            )

        # 6. Comprobar UNA sola vez cada categoría utilizada
        for id_categoria, categoria in sorted(categorias_por_id.items()):
            operaciones.append(
                {
                    "ConditionCheck": {
                        "TableName": TABLA_CATEGORIAS,
                        "Key": av(
                            {"id_usuario": user_id, "id_categoria": id_categoria}
                        ),
                        "ConditionExpression": (
                            "attribute_exists(id_categoria) AND #nombre = :nombre"
                        ),
                        "ExpressionAttributeNames": {"#nombre": "nombre"},
                        "ExpressionAttributeValues": {
                            ":nombre": {"S": categoria["nombre"]}
                        },
                    }
                }
            )

        # 7. Si create tiene category_id=null, exigir catálogo vacío al aceptar.
        if requiere_catalogo_vacio:
            operaciones.append(
                {
                    "ConditionCheck": {
                        "TableName": TABLA_CATEGORIAS,
                        "Key": av(
                            {
                                "id_usuario": user_id,
                                "id_categoria": META_CATEGORIAS,
                            }
                        ),
                        "ConditionExpression": (
                            "attribute_exists(id_categoria) AND #cantidad = :cero"
                        ),
                        "ExpressionAttributeNames": {"#cantidad": "cantidad"},
                        "ExpressionAttributeValues": {":cero": {"N": "0"}},
                    }
                }
            )

        # 8. Marcar propuesta como aceptada EN LA MISMA TRANSACCIÓN
        operaciones.append(
            {
                "Update": {
                    "TableName": TABLA_PROPUESTAS,
                    "Key": av({"id_usuario": user_id, "id_propuesta": id_propuesta}),
                    "UpdateExpression": "SET #s = :aceptada, fecha_resolucion = :ahora",
                    "ConditionExpression": (
                        "#s = :pendiente AND attribute_not_exists(id_siguiente)"
                    ),
                    "ExpressionAttributeNames": {"#s": "status"},
                    "ExpressionAttributeValues": av(
                        {
                            ":aceptada": "aceptada",
                            ":pendiente": "pendiente",
                            ":ahora": ahora,
                        }
                    ),
                }
            }
        )

        cliente.transact_write_items(TransactItems=operaciones)

        return responder(
            200,
            {
                "mensaje": "Cambios aplicados correctamente",
                "id_propuesta": id_propuesta,
                "status": "aceptada",
                "cantidad_acciones": len(acciones),
                "ids_tareas_creadas": ids_creados,
            },
        )

    except ValueError as exc:
        print(f"Propuesta inválida: {exc}")
        return responder(409, {"error": "La propuesta contiene datos no válidos"})

    except ClientError as exc:
        codigo = exc.response["Error"]["Code"]
        print(f"Error DynamoDB: {codigo}")

        if codigo in {"TransactionCanceledException", "TransactionConflictException"}:
            # Si otra petición ya la aceptó, responder de modo idempotente.
            try:
                vigente = propuestas.get_item(
                    Key={"id_usuario": user_id, "id_propuesta": id_propuesta},
                    ConsistentRead=True,
                ).get("Item")
                if vigente and vigente.get("status") == "aceptada":
                    return responder(
                        200,
                        {
                            "mensaje": "La propuesta ya fue aceptada",
                            "id_propuesta": id_propuesta,
                            "status": "aceptada",
                        },
                    )
            except ClientError:
                pass

            razones = exc.response.get("CancellationReasons") or []
            codigos = {r.get("Code") for r in razones if isinstance(r, dict)}
            if codigo == "TransactionConflictException" or codigos.intersection(
                {"ConditionalCheckFailed", "TransactionConflict"}
            ):
                return responder(
                    409,
                    {
                        "error": (
                            "La propuesta, una tarea o una categoría cambió; "
                            "actualiza el chat antes de continuar"
                        )
                    },
                )
            return responder(
                503, {"error": "Conflicto o problema temporal al aplicar los cambios"}
            )

        return responder(500, {"error": "No se pudieron aplicar los cambios"})

    except Exception as exc:
        print(f"Error inesperado: {type(exc).__name__}: {exc}")
        return responder(500, {"error": "Error interno del servidor"})
