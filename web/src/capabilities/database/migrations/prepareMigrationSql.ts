/**
 * iOS @capacitor-community/sqlite execute() strips every newline from SQL that
 * contains DELETE FROM, then hands the result to sqlite3_exec. A leading `--`
 * comment then runs to end of input, so the whole migration becomes a no-op
 * while schema_migrations still advances. Strip line comments here so the
 * remaining statements stay executable after that newline collapse.
 */
export function prepareMigrationSql(sql: string): string {
  const prepared = sql
    .split('\n')
    .map(stripLineComment)
    .join('\n')
    .trim();
  if (!prepared) throw new Error('Migration SQL is empty after stripping comments');
  return prepared;
}

function stripLineComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'") {
      if (inString && line[index + 1] === "'") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (!inString && character === '-' && line[index + 1] === '-') {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}
