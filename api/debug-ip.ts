export default async function handler(req: any, res: any) {
  try {
    const response = await fetch('https://api.ipify.org?format=json')

    if (!response.ok) {
      return res.status(502).json({
        error: 'Não foi possível descobrir o IP de saída.',
      })
    }

    const data = await response.json()

    return res.status(200).json({
      success: true,
      ip: data.ip,
    })
  } catch (error) {
    console.error('[DEBUG-IP] Failed', error)

    return res.status(500).json({
      success: false,
      error: error instanceof Error
        ? error.message
        : String(error),
    })
  }
}