  # ---------------------------------------------------------------------------
  # Tabla: sesiones_evaluacion
  # ---------------------------------------------------------------------------
  # Atributos (solo los de clave se declaran en CloudFormation):
  #   id_usuario          S        PK  UUID (sub de Cognito)
  #   tipo_prueba         S        SK  ia | tradicional
  #   fecha_inicio        S            ISO 8601
  #   fecha_fin           S            ISO 8601 (ausente hasta que termina)
  #   cant_clicks         N            entero >= 0
  #   respuestas_sus      L de N       10 enteros (1-5), orden P1-P10
  #   respuestas_raw_tlx  L de N       6 valores: mental, fisica, temporal, desempeno, esfuerzo, frustracion
  #   orden               N            1 | 2


    # ---------------------------------------------------------------------------
  # Tabla: tareas
  # ---------------------------------------------------------------------------
  # Atributos (solo los de clave se declaran en CloudFormation):
  #   id_usuario          S        PK  UUID
  #   id_tarea            S        SK  ULID
  #   categoria           S            lista cerrada (opcional)
  #   nombre              S            max ~100 caracteres
  #   descripcion         S            opcional, max ~500
  #   fecha_creacion      S            ISO 8601
  #   fecha_hacer         S            ISO 8601 con hora y offset (opcional)
  #   creada_por_ia       BOOL         true | false
  #   estado              S            pendiente | completada | eliminada
  #   id_propuesta        S            ULID (solo si la creo la IA)
  #   fecha_modificacion  S            ISO 8601
  #   fecha_completada    S            ISO 8601 (ausente si no esta completada)

    # ---------------------------------------------------------------------------
  # Tabla: propuestas
  # ---------------------------------------------------------------------------
  # Atributos (solo los de clave se declaran en CloudFormation):
  #   id_usuario          S        PK  UUID
  #   id_propuesta        S        SK  ULID
  #   id_hilo             S            ULID
  #   acciones            L de M       {op, id_tarea?, nombre?, descripcion?, fecha_hacer?, categoria?}
  #                                    op: create | update | complete | delete
  #   mensaje_usuario     S            max ~500 caracteres
  #   respuesta_bot       S
  #   status              S            pendiente | aceptada | cancelada | continuada
  #   fecha_creacion      S            ISO 8601
  #   fecha_resolucion    S            ISO 8601 (ausente mientras este pendiente)
  #   tokens_in           N            entero
  #   tokens_out          N            entero
  #   latencia_ms         N            entero