export async function readApiResponse(response, serviceName) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`${serviceName} is not connected yet. Please try again later.`);
  }

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `${serviceName} could not be completed.`);
  return payload;
}