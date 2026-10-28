/**
 * iOS @capacitor-community/sqlite execute() first trims each line, then — when
 * the SQL contains DELETE FROM — deletes every newline without inserting a
 * space. A leading `--` comment then covers the rest of the file, and
 * `INSERT INTO t\\nSELECT` becomes `tSELECT`, which SQLite reports as
 * `near "id": syntax error`. Collapse comments and whitespace here so the
 * statements stay executable after that rewrite.
 */
export function prepareMigrationSql(sql: string): string {
  const withoutComments = sql.split('\n').map(stripLineComment).join('\n');
  const prepared = withoutComments.replace(/\s+/g, ' ').trim();
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
