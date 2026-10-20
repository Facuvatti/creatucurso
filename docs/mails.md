Integración de envío de emails con Amazon SES (SES v2 API)

Objetivo: enviar los mails de inicio/fin de curso por SES con aislamiento de reputación por tenant y corte automático si un tenant genera rebotes o quejas.

1. Alta programática de cada tenant en SES
- Al crear un tenant, crear un configuration set propio con CreateConfigurationSet. Nombre determinístico, por ejemplo `tenant-{tenantId}`.
- Configurar en ese set un event destination (CreateConfigurationSetEventDestination) hacia un tópico SNS compartido, con los eventos SEND, DELIVERY, BOUNCE, COMPLAINT y REJECT.
- Activar las métricas de reputación en el set (ReputationOptions) para tener métricas separadas por tenant.
- Guardar en la base, por tenant: nombre del configuration set, estado de envío (activo/pausado), límite diario, y contadores de envíos, rebotes duros y quejas.
- Revisar la documentación de SES sobre la función nativa de "tenants" (políticas de reputación y pausa por tenant) y decidir si conviene usarla en vez del esquema manual. Si no está claro o falta soporte en el SDK, usar el esquema manual descrito acá.

2. Envío
- Cada envío (SendEmail) debe llevar siempre el ConfigurationSetName del tenant correspondiente.
- Agregar EmailTags con `tenantId` y `courseId` para poder correlacionar eventos.
- Antes de enviar, verificar: tenant activo, límite diario no superado, y destinatario fuera de la lista de supresión.
- Capa de abstracción sobre el proveedor (interfaz propia tipo `EmailSender`), para poder cambiar de proveedor sin tocar el resto del código.

3. Webhook de eventos
- Endpoint público que recibe las notificaciones de SNS.
- Manejar el SubscriptionConfirmation (confirmar la suscripción) y verificar la firma de cada mensaje SNS antes de procesarlo. Rechazar lo que no valide.
- Identificar el tenant por el nombre del configuration set o por el tag `tenantId` del evento.
- Procesar de forma idempotente (los eventos pueden llegar duplicados o desordenados). Responder 200 rápido y encolar el procesamiento pesado.
- Por tipo de evento:
  - Delivery/Send: actualizar el estado del envío y el contador.
  - Bounce permanente: marcar la dirección como suprimida (global, no solo del tenant) y sumar al contador de rebotes del tenant. Los rebotes transitorios no suprimen ni cuentan como duros.
  - Complaint: suprimir la dirección y sumar al contador de quejas del tenant.
  - Reject: registrar y alertar.

4. Pausa automática por tenant
- Calcular por tenant, sobre una ventana móvil (por ejemplo 7 días o los últimos N envíos), la tasa de rebotes duros y de quejas. Exigir un mínimo de envíos antes de evaluar (por ejemplo 100) para no pausar por muestras chicas.
- Umbrales de partida: rebotes duros > 5% o quejas > 0,1%. Dejarlos configurables.
- Al superar un umbral: deshabilitar el set con PutConfigurationSetSendingOptions (SendingEnabled=false), marcar el tenant como pausado en la base y notificar al administrador. El resto de los tenants no se ve afectado.
- Reactivación manual por un admin, no automática.

5. Datos mínimos
- Tabla/campos de tenant: configurationSetName, sendingStatus, dailyLimit.
- Tabla de envíos con messageId de SES, tenantId, estado y timestamps.
- Tabla de supresión: email, motivo (bounce/complaint), fecha.

6. Cuenta de AWS
- La cuenta empieza en sandbox: hay que solicitar acceso a producción antes de salir en vivo. Dejarlo anotado como paso pendiente.
- Credenciales de IAM con permisos mínimos (ses:SendEmail y ses:*ConfigurationSet*) y el tópico SNS con política que permita publicar a SES.
