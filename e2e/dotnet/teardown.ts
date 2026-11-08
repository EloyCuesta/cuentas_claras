import { dropDotnetDatabase } from './database.ts'

/** Al terminar la suite .NET: no deja su base de ensayo (cuentas_test_e2e_dotnet). */
export default async function teardown(): Promise<void> {
  await dropDotnetDatabase()
}
