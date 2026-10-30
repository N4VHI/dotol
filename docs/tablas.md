# Documentación de Tablas (DynamoDB)

*Nota: Solo los atributos de clave (PK, SK) se declaran explícitamente en la plantilla de CloudFormation.*

---

## Tabla: `sesiones_evaluacion`

| Atributo | Tipo | Clave | Descripción / Notas |
| :--- | :---: | :---: | :--- |
| `id_usuario` | S | **PK** | UUID (sub de Cognito) |
| `tipo_prueba` | S | **SK** | `ia` \| `tradicional` |
| `fecha_inicio` | S | | ISO 8601 |
| `fecha_fin` | S | | ISO 8601 (ausente hasta que termina) |
| `cant_clicks` | N | | Entero $\ge 0$ |
| `respuestas_sus` | L de N | | 10 enteros (1-5), orden P1-P10 |
| `respuestas_raw_tlx` | L de N | | 6 valores: mental, física, temporal, desempeño, esfuerzo, frustración |
| `orden` | N | | `1` \| `2` |

---

## Tabla: `tareas`

| Atributo | Tipo | Clave | Descripción / Notas |
| :--- | :---: | :---: | :--- |
| `id_usuario` | S | **PK** | UUID |
| `id_tarea` | S | **SK** | ULID |
| `categoria` | S | | Lista cerrada (opcional) |
| `nombre` | S | | Máximo ~100 caracteres |
| `descripcion` | S | | Opcional, máximo ~500 caracteres |
| `fecha_creacion` | S | | ISO 8601 |
| `fecha_hacer` | S | | ISO 8601 con hora y offset (opcional) |
| `creada_por_ia` | BOOL | | `true` \| `false` |
| `estado` | S | | `pendiente` \| `completada` \| `eliminada` |
| `id_propuesta` | S | | ULID (solo si la creó la IA) |
| `fecha_modificacion` | S | | ISO 8601 |
| `fecha_completada` | S | | ISO 8601 (ausente si no está completada) |

---

## Tabla: `propuestas`

| Atributo | Tipo | Clave | Descripción / Notas |
| :--- | :---: | :---: | :--- |
| `id_usuario` | S | **PK** | UUID |
| `id_propuesta` | S | **SK** | ULID |
| `id_hilo` | S | | ULID |
| `acciones` | L de M | | `{op, id_tarea?, nombre?, descripcion?, fecha_hacer?, categoria?}` <br> *op:* `create` \| `update` \| `complete` \| `delete` |
| `mensaje_usuario` | S | | Máximo ~500 caracteres |
| `respuesta_bot` | S | | Respuesta generada por el bot |
| `status` | S | | `pendiente` \| `aceptada` \| `cancelada` \| `continuada` |
| `fecha_creacion` | S | | ISO 8601 |
| `fecha_resolucion` | S | | ISO 8601 (ausente mientras esté pendiente) |
| `tokens_in` | N | | Entero |
| `tokens_out` | N | | Entero |
| `latencia_ms` | N | | Entero |