/**
 * Solo para runServer (serverProcess.ts) en Windows, precargado con --import. Allí no hay señales entre procesos:
 * child.kill() termina el proceso sin avisarle (TerminateProcess), con código null. Con esto, la prueba le pide por
 * IPC la señal de Ctrl+C y el servidor ejecuta su propio cierre, el mismo de process.on('SIGINT') en server/index.ts.
 */
process.channel?.unref()
process.on('message', (message: unknown) => {
  if (message === 'SIGINT' || message === 'SIGTERM') process.emit(message)
})
