// Tokenización de tarjetas con Mercado Pago (el mismo paso que hace su SDK de JavaScript).
// Los datos de la tarjeta van del navegador directo a Mercado Pago con la clave pública de M7;
// a M6 sólo le llega el token, que M6 reenvía a M7 para autorizar el pago.
export const mpPublicKey: string = import.meta.env.VITE_MP_PUBLIC_KEY ?? ''
export const cardEnabled = Boolean(mpPublicKey)

export interface CardInput {
  number: string
  expiry: string
  cvv: string
  holder: string
  dni: string
}

export const emptyCard: CardInput = { number: '', expiry: '', cvv: '', holder: '', dni: '' }

const digits = (value: string) => value.replace(/\D/g, '')

export function formatCardNumber(value: string) {
  return digits(value).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ')
}

export function formatExpiry(value: string) {
  const clean = digits(value).slice(0, 4)
  return clean.length > 2 ? `${clean.slice(0, 2)}/${clean.slice(2)}` : clean
}

function luhn(number: string) {
  let sum = 0
  for (let i = 0; i < number.length; i += 1) {
    let digit = Number(number[number.length - 1 - i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

/** Devuelve el primer problema de la tarjeta, o una cadena vacía si se puede tokenizar. */
export function cardProblem(card: CardInput) {
  const number = digits(card.number)
  if (number.length < 13 || number.length > 19 || !luhn(number)) return 'Revisá el número de la tarjeta.'
  const [month, year] = card.expiry.split('/').map(Number)
  const now = new Date()
  const expires = new Date(2000 + (year || 0), month || 0, 1)
  if (!month || month > 12 || !year || expires <= now) return 'Revisá el vencimiento (MM/AA).'
  if (!/^\d{3,4}$/.test(card.cvv)) return 'El código de seguridad tiene 3 o 4 dígitos.'
  if (card.holder.trim().length < 2) return 'Escribí el nombre del titular como figura en la tarjeta.'
  if (!/^\d{7,8}$/.test(digits(card.dni))) return 'El DNI tiene 7 u 8 dígitos.'
  return ''
}

function brandFromBin(number: string) {
  if (/^4/.test(number)) return 'visa'
  if (/^(5[1-5]|2[2-7])/.test(number)) return 'master'
  if (/^3[47]/.test(number)) return 'amex'
  return 'visa'
}

async function paymentMethodId(number: string) {
  try {
    const params = new URLSearchParams({ public_key: mpPublicKey, bins: number.slice(0, 6) })
    const response = await fetch(`https://api.mercadopago.com/v1/payment_methods/search?${params}`)
    const data = await response.json() as { results?: Array<{ id: string; payment_type_id: string }> }
    const method = data.results?.find((item) => item.payment_type_id === 'credit_card' || item.payment_type_id === 'debit_card')
    if (method) return method.id
  } catch {
    // Sin respuesta de Mercado Pago se usa la marca deducida del número.
  }
  return brandFromBin(number)
}

export async function tokenizeCard(card: CardInput, email: string) {
  const problem = cardProblem(card)
  if (problem) throw new Error(problem)
  const number = digits(card.number)

  if (!mpPublicKey) throw new Error('El pago con tarjeta no está habilitado en este entorno.')

  const [month, year] = card.expiry.split('/').map(Number)
  const response = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(mpPublicKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_number: number,
      expiration_month: month,
      expiration_year: 2000 + year,
      security_code: card.cvv,
      cardholder: { name: card.holder.trim(), identification: { type: 'DNI', number: digits(card.dni) } },
    }),
  }).catch(() => null)
  const data = await response?.json().catch(() => null) as { id?: string; message?: string } | null
  if (!response?.ok || !data?.id) {
    throw new Error(`Mercado Pago no validó la tarjeta${data?.message ? `: ${data.message}` : '. Revisá los datos e intentá de nuevo.'}`)
  }
  return { token: data.id, paymentMethodId: await paymentMethodId(number), email }
}
