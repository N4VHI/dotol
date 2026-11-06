"""Control de una evaluación intra-sujetos de DOTOL.

Tabla DynamoDB: sesiones_evaluacion
PK: id_usuario (Cognito sub), SK: tipo_prueba (ia|tradicional).

El frontend inicia cada prueba, llama finalizar SOLO tras una aceptación
exitosa y presenta los cuestionarios TLX y SUS en ese orden.
"""

import json
import logging
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

tabla = boto3.resource("dynamodb").Table(os.environ["TABLA_EVALUACIONES"])
cliente = boto3.client("dynamodb")

METODOS = ("ia", "tradicional")
PENDIENTE = "pendiente"
EN_CURSO = "en_curso"
PENDIENTE_TLX = "pendiente_tlx"
PENDIENTE_SUS = "pendiente_sus"
COMPLETADA = "completada"
ESTADOS = {PENDIENTE, EN_CURSO, PENDIENTE_TLX, PENDIENTE_SUS, COMPLETADA}



# Dos consignas libres, una para cada método. No interpretamos ni contamos las
# tareas en la Lambda: la verificación del cumplimiento será posterior al estudio.
def validar_grupos(datos):
    grupos = datos.get("grupos")
    if not isinstance(grupos, dict) or set(grupos) != {"A", "B"}:
        raise ValueError("Envía los grupos A y B")
    preparados = {}
    for grupo in ("A", "B"):
        texto = grupos[grupo]
        if not isinstance(texto, str) or not (1 <= len(texto.strip()) <= 2500):
            raise ValueError(f"El grupo {grupo} debe contener un texto entre 1 y 2500 caracteres")
        preparados[grupo] = texto.strip()
    return preparados


def utc_ahora():
    return datetime.now(timezone.utc)


def json_default(valor):
    if isinstance(valor, Decimal):
        return int(valor) if valor == valor.to_integral_value() else float(valor)
    raise TypeError(f"No es serializable: {type(valor).__name__}")


def responder(codigo, contenido):
    return {
        "statusCode": codigo,
        "headers": {"Content-Type": "application/json; charset=utf-8"},
        "body": json.dumps(contenido, ensure_ascii=False, default=json_default),
    }


def obtener_registros(usuario):
    # Lectura consistente para que un GET inmediato vea los cambios recién guardados.
    respuesta = tabla.query(
        KeyConditionExpression=Key("id_usuario").eq(usuario),
        ConsistentRead=True,
    )
    elementos = respuesta.get("Items", [])
    while "LastEvaluatedKey" in respuesta:
        respuesta = tabla.query(
            KeyConditionExpression=Key("id_usuario").eq(usuario),
            ConsistentRead=True,
            ExclusiveStartKey=respuesta["LastEvaluatedKey"],
        )
        elementos.extend(respuesta.get("Items", []))
    return sorted(
        (x for x in elementos if x.get("tipo_prueba") in METODOS),
        key=lambda x: x.get("orden", 99),
    )


def obtener_actual(registros):
    return next((x for x in registros if x.get("estado") != COMPLETADA), None)


def estado_evaluacion(usuario):
    registros = obtener_registros(usuario)
    if not registros:
        return {
            "estado_global": "no_iniciada",
            "pantalla": "instrucciones",
            "metodo_actual": None,
            "orden_actual": None,
            "evaluaciones": [],
        }
    if len(registros) != 2 or set(x["tipo_prueba"] for x in registros) != set(METODOS):
        raise ValueError("Los registros de evaluación del usuario están incompletos")
    if set(x.get("orden") for x in registros) != {1, 2}:
        raise ValueError("Los números de orden de la evaluación no son válidos")
    if any(x.get("estado") not in ESTADOS for x in registros):
        raise ValueError("Los estados de la evaluación no son válidos")

    actual = obtener_actual(registros)
    pantallas = {
        PENDIENTE: "instrucciones",
        EN_CURSO: "metodo",
        PENDIENTE_TLX: "nasa_tlx",
        PENDIENTE_SUS: "sus",
    }
    return {
        "estado_global": "completada" if actual is None else "en_progreso",
        "pantalla": "finalizado" if actual is None else pantallas[actual["estado"]],
        "metodo_actual": actual["tipo_prueba"] if actual else None,
        "orden_actual": actual["orden"] if actual else None,
        "evaluaciones": [
            {
                "tipo_prueba": x["tipo_prueba"],
                "orden": x["orden"],
                "estado": x["estado"],
                "fecha_inicio": x.get("fecha_inicio"),
                "fecha_fin": x.get("fecha_fin"),
                "cant_clicks": x.get("cant_clicks"),
                "duracion_segundos": x.get("duracion_segundos"),
                "cant_tareas": x.get("cant_tareas"),
                "puntaje_sus": x.get("puntaje_sus"),
                "puntaje_raw_tlx": x.get("puntaje_raw_tlx"),
                "grupo_asignado": x.get("grupo_asignado"),
                "cantidad_objetivo": len(x.get("tareas_objetivo", [])) if "tareas_objetivo" in x else None,
                # No se adelantan las tareas del segundo método al cliente.
                "tareas_objetivo": (
                    x.get("tareas_objetivo", [])
                    if actual is not None and x["tipo_prueba"] == actual["tipo_prueba"]
                    else []
                ),
                # Solo se revela el texto del grupo correspondiente al método actual.
                "texto_grupo": (
                    x.get("texto_grupo")
                    if actual is not None and x["tipo_prueba"] == actual["tipo_prueba"]
                    else None
                ),
            }
            for x in registros
        ],
    }


def preparar(usuario, datos):
    existentes = obtener_registros(usuario)
    if existentes:
        if len(existentes) != 2:
            return responder(409, {"error": "La evaluación presenta datos incompletos"})
        return responder(200, estado_evaluacion(usuario))

    grupos = validar_grupos(datos)
    primero = METODOS[secrets.randbelow(2)]
    segundo = "tradicional" if primero == "ia" else "ia"
    grupo_primero = "A" if secrets.randbelow(2) == 0 else "B"
    grupo_segundo = "B" if grupo_primero == "A" else "A"
    fecha = utc_ahora().isoformat()
    elementos = []
    for metodo, orden, grupo in ((primero, 1, grupo_primero), (segundo, 2, grupo_segundo)):
        elementos.append({
            "Put": {
                "TableName": tabla.name,
                "Item": {
                    "id_usuario": {"S": usuario},
                    "tipo_prueba": {"S": metodo},
                    "orden": {"N": str(orden)},
                    "estado": {"S": PENDIENTE},
                    "fecha_registro_evaluacion": {"S": fecha},
                    "grupo_asignado": {"S": grupo},
                    "texto_grupo": {"S": grupos[grupo]},
                },
                "ConditionExpression": "attribute_not_exists(id_usuario)",
            }
        })

    try:
        # Ambas filas nacen al mismo tiempo o no se crea ninguna.
        cliente.transact_write_items(TransactItems=elementos)
    except cliente.exceptions.TransactionCanceledException:
        # Otra pestaña pudo haber realizado la inicialización al mismo tiempo.
        if len(obtener_registros(usuario)) != 2:
            raise
    return responder(200, estado_evaluacion(usuario))


def actualizar_condicional(usuario, metodo, estado_esperado, nuevo_estado,
                         asignaciones, nombres=None):
    """Una transición de estado condicional; evita repetir o saltar pasos."""
    nombres_expr = {"#estado": "estado"}
    if nombres:
        nombres_expr.update(nombres)
    valores = {
        ":esperado": estado_esperado,
        ":nuevo": nuevo_estado,
    }
    partes = ["#estado = :nuevo"]
    for alias, (atributo, valor) in asignaciones.items():
        partes.append(f"{alias} = :valor_{atributo}")
        valores[f":valor_{atributo}"] = valor
        nombres_expr[alias] = atributo

    tabla.update_item(
        Key={"id_usuario": usuario, "tipo_prueba": metodo},
        UpdateExpression="SET " + ", ".join(partes),
        ConditionExpression="#estado = :esperado",
        ExpressionAttributeNames=nombres_expr,
        ExpressionAttributeValues=valores,
    )


def leer_actual_para_operacion(usuario):
    registros = obtener_registros(usuario)
    if len(registros) != 2:
        return None, responder(409, {"error": "Primero prepara la evaluación"})
    actual = obtener_actual(registros)
    if actual is None:
        return None, responder(409, {"error": "La evaluación ya terminó"})
    return actual, None


def iniciar(usuario):
    actual, error = leer_actual_para_operacion(usuario)
    if error:
        return error
    if actual["estado"] == EN_CURSO:
        return responder(200, estado_evaluacion(usuario))
    if actual["estado"] != PENDIENTE:
        return responder(409, {"error": "No puedes iniciar mientras faltan cuestionarios"})

    # Si es el segundo método, el primero ya tuvo que completarse.
    registros = obtener_registros(usuario)
    if actual["orden"] == 2 and registros[0]["estado"] != COMPLETADA:
        return responder(409, {"error": "Primero completa la evaluación inicial"})

    actualizar_condicional(
        usuario, actual["tipo_prueba"], PENDIENTE, EN_CURSO,
        {"#inicio": ("fecha_inicio", utc_ahora().isoformat())},
    )
    return responder(200, estado_evaluacion(usuario))


def leer_cuerpo(evento):
    cuerpo = evento.get("body") or "{}"
    if evento.get("isBase64Encoded"):
        import base64
        cuerpo = base64.b64decode(cuerpo).decode("utf-8")
    objeto = json.loads(cuerpo)
    if not isinstance(objeto, dict):
        raise ValueError("El cuerpo JSON debe ser un objeto")
    return objeto


def finalizar(usuario, datos):
    clicks = datos.get("cant_clicks")
    if type(clicks) is not int or not (0 <= clicks <= 1000000):
        return responder(400, {"error": "cant_clicks debe ser un entero entre 0 y 1000000"})

    # Cantidad REAL de tareas creadas durante la prueba (puede ser 0 si
    # el usuario solo actualizó, completó o eliminó tareas).
    cant_tareas = datos.get("cant_tareas", 0)
    if type(cant_tareas) is not int or not (0 <= cant_tareas <= 1000):
        return responder(400, {"error": "cant_tareas debe ser un entero entre 0 y 1000"})

    actual, error = leer_actual_para_operacion(usuario)
    if error:
        return error
    if actual["estado"] != EN_CURSO:
        return responder(409, {"error": "El método no está en curso"})
    try:
        comienzo = datetime.fromisoformat(actual["fecha_inicio"])
    except (KeyError, TypeError, ValueError):
        return responder(409, {"error": "Falta fecha_inicio de la evaluación"})

    fin = utc_ahora()
    segundos = (fin - comienzo).total_seconds()
    if segundos < 0:
        return responder(409, {"error": "La fecha de inicio es posterior al fin"})
    duracion = Decimal(str(segundos)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    nuevos_valores = {
        "#fin": ("fecha_fin", fin.isoformat()),
        "#clicks": ("cant_clicks", clicks),
        "#duracion": ("duracion_segundos", duracion),
    }
    nuevos_valores["#tareas"] = ("cant_tareas", cant_tareas)

    actualizar_condicional(
        usuario, actual["tipo_prueba"], EN_CURSO, PENDIENTE_TLX,
        nuevos_valores,
    )
    return responder(200, estado_evaluacion(usuario))


def validar_respuestas(respuestas, cantidad, minimo, maximo):
    return (
        isinstance(respuestas, list)
        and len(respuestas) == cantidad
        and all(type(x) is int and minimo <= x <= maximo for x in respuestas)
    )


def registrar_tlx(usuario, datos):
    respuestas = datos.get("respuestas")
    if not validar_respuestas(respuestas, 6, 0, 100):
        return responder(400, {"error": "NASA Raw TLX requiere 6 enteros entre 0 y 100"})
    actual, error = leer_actual_para_operacion(usuario)
    if error:
        return error
    if actual["estado"] != PENDIENTE_TLX:
        return responder(409, {"error": "Primero termina la prueba y habilita NASA-TLX"})
    puntaje = (Decimal(sum(respuestas)) / Decimal(6)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    actualizar_condicional(
        usuario, actual["tipo_prueba"], PENDIENTE_TLX, PENDIENTE_SUS,
        {
            "#respuestas_tlx": ("respuestas_raw_tlx", respuestas),
            "#puntaje_tlx": ("puntaje_raw_tlx", puntaje),
        },
    )
    return responder(200, estado_evaluacion(usuario))


def registrar_sus(usuario, datos):
    respuestas = datos.get("respuestas")
    if not validar_respuestas(respuestas, 10, 1, 5):
        return responder(400, {"error": "SUS requiere 10 enteros del 1 al 5"})
    actual, error = leer_actual_para_operacion(usuario)
    if error:
        return error
    if actual["estado"] != PENDIENTE_SUS:
        return responder(409, {"error": "Primero registra NASA-TLX"})

    suma = sum(valor - 1 if indice % 2 == 0 else 5 - valor
               for indice, valor in enumerate(respuestas))
    puntaje = Decimal(suma) * Decimal("2.5")
    actualizar_condicional(
        usuario, actual["tipo_prueba"], PENDIENTE_SUS, COMPLETADA,
        {
            "#respuestas_sus": ("respuestas_sus", respuestas),
            "#puntaje_sus": ("puntaje_sus", puntaje),
            "#fecha_completada": ("fecha_evaluacion_completada", utc_ahora().isoformat()),
        },
    )
    return responder(200, estado_evaluacion(usuario))


def lambda_handler(event, context):
    try:
        usuario = event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
        metodo_http = (event.get("requestContext", {}).get("http", {}).get("method")
                       or event.get("httpMethod") or "").upper()
        ruta = (event.get("rawPath") or event.get("path") or "").rstrip("/")

        if metodo_http == "GET" and ruta == "/evaluacion/estado":
            return responder(200, estado_evaluacion(usuario))
        if metodo_http != "POST":
            return responder(404, {"error": "Ruta o método no disponible"})
        if ruta == "/evaluacion/preparar":
            return preparar(usuario, leer_cuerpo(event))
        if ruta == "/evaluacion/iniciar":
            return iniciar(usuario)
        if ruta == "/evaluacion/finalizar":
            return finalizar(usuario, leer_cuerpo(event))
        if ruta == "/evaluacion/raw-tlx":
            return registrar_tlx(usuario, leer_cuerpo(event))
        if ruta == "/evaluacion/sus":
            return registrar_sus(usuario, leer_cuerpo(event))
        return responder(404, {"error": "Ruta no encontrada"})

    except (json.JSONDecodeError, ValueError) as error:
        logger.warning("Solicitud inválida: %s", error)
        return responder(400, {"error": "Datos inválidos en la solicitud"})
    except ClientError as error:
        codigo = error.response.get("Error", {}).get("Code", "Error")
        detalle = error.response.get("Error", {}).get("Message", "")
        logger.exception("Error DynamoDB %s: %s", codigo, detalle)
        if codigo in {"ConditionalCheckFailedException", "TransactionCanceledException"}:
            return responder(409, {"error": "La evaluación cambió; vuelve a consultar su estado"})
        return responder(500, {"error": "No se pudo registrar la evaluación"})
    except Exception:
        logger.exception("Error inesperado en evaluación")
        return responder(500, {"error": "Error interno"})
