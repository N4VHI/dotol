"""Cuotas de Bedrock para DOTOL (autorización en backend).

Usa la tabla existente sesiones_evaluacion:
- Participante: fila (sub, 'ia'), solo con estado en_curso, hasta 8 intentos.
- Admin: fila (sub, 'admin#AAAA-MM-DD'), hasta N intentos por día.
- Todos: fila ('__CONTROL_IA_GLOBAL__', 'dia#AAAA-MM-DD'), tope compartido.

Las reservas ocurren en UNA transacción DynamoDB ANTES de invocar Bedrock.
Solo los claims Cognito validados por el autorizador JWT permiten ser admin.
"""

import json
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from botocore.exceptions import ClientError


GRUPO_ADMIN = "dotol-admins"
USUARIO_GLOBAL = "__CONTROL_IA_GLOBAL__"


class AccesoIADenegado(Exception):
    """La cuenta no está en su prueba de IA."""


class CuotaIAAgotada(Exception):
    """Se alcanzó una cuota de IA de DOTOL."""


def _limite(nombre, predeterminado):
    try:
        numero = int(os.environ.get(nombre, str(predeterminado)))
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"Configuración inválida: {nombre}") from exc
    if not 1 <= numero <= 10000:
        raise RuntimeError(f"Configuración fuera de rango: {nombre}")
    return numero


def grupos_de_cognito(claims):
    """Acepta el claim como lista o su representación textual desde API Gateway."""
    valor = claims.get("cognito:groups", [])
    if isinstance(valor, list):
        return set(v for v in valor if isinstance(v, str))
    if isinstance(valor, str):
        try:
            decodificado = json.loads(valor)
        except (ValueError, TypeError):
            decodificado = None
        if isinstance(decodificado, list):
            return set(v for v in decodificado if isinstance(v, str))
        return {
            s.strip().strip("[]\"' ")
            for s in valor.split(",")
            if s.strip().strip("[]\"' ")
        }
    return set()


def es_admin(claims):
    return GRUPO_ADMIN in grupos_de_cognito(claims)


def _update_cuota(tabla, usuario, tipo, limite, condicionado_estado=False):
    nombres = {"#n": "llamadas_ia"}
    valores = {
        ":cero": {"N": "0"},
        ":uno": {"N": "1"},
        ":maximo": {"N": str(limite)},
    }
    condicion = "(attribute_not_exists(#n) OR #n < :maximo)"
    if condicionado_estado:
        nombres["#estado"] = "estado"
        valores[":activo"] = {"S": "en_curso"}
        condicion = "attribute_exists(id_usuario) AND #estado = :activo AND " + condicion
    return {
        "Update": {
            "TableName": tabla,
            "Key": {
                "id_usuario": {"S": usuario},
                "tipo_prueba": {"S": tipo},
            },
            "UpdateExpression": "SET #n = if_not_exists(#n, :cero) + :uno",
            "ConditionExpression": condicion,
            "ExpressionAttributeNames": nombres,
            "ExpressionAttributeValues": valores,
        }
    }


def reservar_llamada(cliente, *, usuario, claims, ahora=None):
    """Reserva 1 intento. Falla cerrado y evita superar límites con concurrencia.

    Los intentos fallidos tras la reserva también cuentan, pues pueden consumir
    tokens y recursos de Bedrock. No se reembolsan automáticamente.
    """
    tabla = os.environ.get("TABLA_EVALUACIONES", "").strip()
    if not tabla:
        raise RuntimeError("Falta TABLA_EVALUACIONES: la IA se bloquea por seguridad")
    if not usuario or usuario == USUARIO_GLOBAL:
        raise AccesoIADenegado("Identidad de Cognito inválida")

    participante_max = _limite("IA_LIMITE_PARTICIPANTE", 8)
    admin_max = _limite("IA_LIMITE_ADMIN_DIA", 60)
    global_max = _limite("IA_LIMITE_GLOBAL_DIA", 100)
    administrador = es_admin(claims)
    if ahora is None:
        ahora = datetime.now(ZoneInfo("America/Lima"))
    dia = ahora.astimezone(ZoneInfo("America/Lima")).date().isoformat()

    if administrador:
        usuario_tipo = f"admin#{dia}"
        usuario_max = admin_max
    else:
        usuario_tipo = "ia"
        usuario_max = participante_max
        # UX mejor: avisar a quien no está en la prueba sin cargar Bedrock.
        comprobacion = cliente.get_item(
            TableName=tabla,
            Key={
                "id_usuario": {"S": usuario},
                "tipo_prueba": {"S": "ia"},
            },
            ConsistentRead=True,
        ).get("Item") or {}
        if comprobacion.get("estado", {}).get("S") != "en_curso":
            raise AccesoIADenegado(
                "El chatbot está habilitado solo durante tu prueba del Método IA."
            )
        usados = int(comprobacion.get("llamadas_ia", {}).get("N", "0"))
        if usados >= participante_max:
            raise CuotaIAAgotada(
                f"Alcanzaste el máximo de {participante_max} mensajes de IA en tu prueba."
            )

    # La transacción no permite superar el tope aunque abran varias pestañas.
    cambios = [
        _update_cuota(tabla, usuario, usuario_tipo, usuario_max, not administrador),
        _update_cuota(tabla, USUARIO_GLOBAL, f"dia#{dia}", global_max),
    ]
    for intento in range(3):
        try:
            cliente.transact_write_items(TransactItems=cambios)
            return {"admin": administrador, "dia": dia}
        except ClientError as exc:
            codigo = exc.response.get("Error", {}).get("Code", "")
            if codigo != "TransactionCanceledException":
                raise
            motivos = exc.response.get("CancellationReasons", [])
            if any(m.get("Code") == "TransactionConflict" for m in motivos):
                if intento < 2:
                    time.sleep(0.04 * (intento + 1))
                    continue
                raise
            # La condición del primer Update protege estado/cuota individual;
            # la del segundo protege el techo diario global.
            if len(motivos) >= 2 and motivos[1].get("Code") == "ConditionalCheckFailed":
                raise CuotaIAAgotada("Se alcanzó el cupo diario de IA de dotol.") from exc
            if not administrador and len(motivos) >= 1 and motivos[0].get("Code") == "ConditionalCheckFailed":
                raise CuotaIAAgotada(
                    "La prueba de IA terminó o llegaste al máximo de mensajes permitidos."
                ) from exc
            if administrador and len(motivos) >= 1 and motivos[0].get("Code") == "ConditionalCheckFailed":
                raise CuotaIAAgotada("Se alcanzó el cupo diario de seguridad de la administradora.") from exc
            # Si DynamoDB no entregó motivos, negar la invocación por seguridad.
            raise CuotaIAAgotada("No se pudo reservar una solicitud de IA. Reintenta más tarde.") from exc

    raise RuntimeError("No se pudo verificar la cuota de IA")
