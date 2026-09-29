# Guía de uso de Our story (entorno test)

**Abrir la app:** https://dshybjuk3ufo9.cloudfront.net/

Our story es una aplicación web para guardar recuerdos compartidos, conversar sobre ellos y enviar tarjetas a la otra persona. Puedes abrir el enlace en el navegador de una computadora o un celular. Esta guía corresponde al entorno **test**; sus datos están separados de los de producción.

## 1. Entrar a tu cuenta

1. Abre el enlace y pulsa **Sign in with your invitation**.
2. En la pantalla de inicio de sesión, escribe el correo de la cuenta invitada y tu contraseña.
3. Si recibiste un código de restablecimiento, completa ese proceso en la pantalla de inicio de sesión y elige una contraseña nueva.
4. Al terminar, volverás a la app. Para salir, pulsa **Sign out**.

No hay registro público dentro de la app: la cuenta debe estar previamente habilitada. Si aparece un error de sesión expirada, vuelve a iniciar sesión.

## 2. Guardar un recuerdo

1. Entra a **Timeline** y pulsa **Add a memory**.
2. Escribe un **Title**, la **Date** y el texto en **Memory**. Puedes añadir lugar, etiquetas separadas por comas, categoría e idioma.
3. Pulsa **Save memory**. Se abrirá la página del recuerdo.
4. Para añadir una foto, usa **Add up to 10 photos** en esa página. Admite JPEG, PNG o WebP, con un máximo de 10 MiB por foto.

En la página del recuerdo puedes usar **Edit**, **Remove photo** o **Delete this memory**. La eliminación del recuerdo pide confirmación y también elimina sus fotos.

El indicador **Index** muestra cuándo el texto está listo para el chat: **PENDING** significa que se está procesando; **INDEXED**, que ya puede consultarse. Si aparece **FAILED**, pulsa **Retry indexing**. Si aparece **NOT_REQUESTED**, pulsa **Index memory**. Las fotos se muestran en el recuerdo, pero el chat usa el texto guardado, no interpreta las imágenes.

## 3. Preguntar sobre sus recuerdos

1. Entra a **Chat** y pulsa **New chat** si quieres iniciar otra conversación.
2. Escribe una pregunta sobre recuerdos guardados y pulsa **Ask**.
3. Abre los enlaces bajo la respuesta para revisar los recuerdos que la respaldan.

Puedes abrir **Filter memories** para limitar la búsqueda por fechas, categoría o etiquetas. Si no encuentra evidencia suficiente, el asistente lo indicará en vez de inventar una respuesta. Para obtener mejores resultados, espera a que los recuerdos relevantes muestren **INDEXED**.

## 4. Crear y enviar una tarjeta

1. Entra a **Cards** y pulsa **Create a card**.
2. Elige a tu pareja en **Recipient**. Puedes indicar ocasión, tono, idioma y seleccionar recuerdos como referencia.
3. Escribe el título y mensaje, o pulsa **Generate suggestion**. Si te gusta la propuesta, pulsa **Use this draft**; también puedes editarla antes de continuar.
4. Pulsa **Save draft** para guardar la tarjeta. Guardarla o generar una propuesta **no la envía**.
5. Cuando esté lista, pulsa **Preview & send**. Revisa destinatario y contenido. Puedes elegir **Schedule for later** para programarla; la pantalla muestra la zona horaria de tu dispositivo.
6. Pulsa **Confirm send** para enviarla. **Cancel** cierra la confirmación sin enviarla.

En **Cards** puedes volver a abrir tus borradores y ver el estado de las tarjetas enviadas. El envío bloquea la versión guardada de la tarjeta.

## 5. Leer una tarjeta recibida

Entra a **Inbox** y abre la tarjeta. Un punto de color indica que está sin leer. Al abrirla, se marca como leída. Si incluye recuerdos de apoyo, puedes seguir los enlaces **View memory**.

## Uso en celular

Abre el mismo enlace en Safari o Chrome. La interfaz se adapta al ancho de la pantalla; actualmente es una aplicación web, no una app nativa descargable desde App Store o Google Play. Puedes crear un acceso directo a la pantalla de inicio desde el menú de tu navegador.

## Si algo falla

- **No puedes entrar:** comprueba que usas el correo habilitado para test y completa el restablecimiento de contraseña si corresponde.
- **El chat no encuentra un recuerdo:** revisa que el recuerdo esté guardado y que **Index** muestre **INDEXED**; después pregunta de nuevo.
- **Una foto no carga:** comprueba que sea JPEG, PNG o WebP y no supere 10 MiB.
- **Aparece un error con “Reference”:** conserva ese identificador para que podamos localizar el fallo sin compartir tu contraseña ni el contenido privado.
