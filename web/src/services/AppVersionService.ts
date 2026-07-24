function formatBuildTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

export const appVersionInfo = {
  version: __APP_VERSION__,
  buildTime: __APP_BUILD_TIME__,
  label: `v${__APP_VERSION__}`,
  buildLabel: `构建 ${formatBuildTime(__APP_BUILD_TIME__)}`
};
