export function dopAuthorizationFileName(customerName: string) {
  const safeName = customerName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return `DOP-${safeName || 'Customer'}.pdf`;
}

export function signedAuthorizationDownloadName(fileName: string, documentType: string | null, customerName: string) {
  if (documentType === 'repair_authorization' && /^signed-repair-authorization-/i.test(fileName)) {
    return dopAuthorizationFileName(customerName);
  }
  return fileName;
}
