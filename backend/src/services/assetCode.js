/**
 * Benzersiz cihaz kodu üretir: IT-<YIL>-<6 haneli sıra>, örn. IT-2026-000042.
 * Sıra PostgreSQL SEQUENCE'ından gelir; sequence geri sarmadığı için kod hiç tekrar etmez
 * (ayrıca assets.asset_code UNIQUE kısıtı ikinci bir güvencedir).
 */
export async function nextAssetCode(client) {
  const { rows } = await client.query("SELECT nextval('asset_code_seq') AS n");
  const year = new Date().getFullYear();
  return `IT-${year}-${String(rows[0].n).padStart(6, '0')}`;
}
