export default async function config() {
  return {
    origins: await Promise.resolve([location.origin]),
    headers: () => ({ Authorization: 'Bearer test-token' }),
  };
}
