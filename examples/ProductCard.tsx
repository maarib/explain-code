import { useState } from 'react'
import './tokens.css'

type Size = 'small' | 'large'

type ProductCardProps = {
  title: string
  price: number
  image: string
  tags?: string[]
  size?: Size
  onAddToCart: (title: string) => Promise<void>
}

const LABELS = {
  add: 'Add to cart',
  adding: 'Adding…',
  added: 'Added ✓',
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)
}

export function ProductCard({ title, price, image, tags = [], size = 'large', onAddToCart }: ProductCardProps) {
  const [status, setStatus] = useState<'idle' | 'adding' | 'added'>('idle')
  const [isFavorite, setIsFavorite] = useState(false)

  const handleAdd = async () => {
    setStatus('adding')
    try {
      await onAddToCart(title)
      setStatus('added')
    } catch {
      setStatus('idle')
    }
  }

  return (
    <article className={`card card--${size}`}>
      <img className="card__image" src={image} alt={title} />

      <button
        className="card__favorite"
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={isFavorite}
        onClick={() => setIsFavorite(!isFavorite)}
      >
        {isFavorite ? '♥' : '♡'}
      </button>

      <div className="card__body">
        <h3 className="card__title">{title}</h3>
        <p className="card__price">{formatPrice(price)}</p>

        {tags.length > 0 && (
          <ul className="card__tags">
            {tags.map(tag => (
              <li key={tag} className="card__tag">{tag}</li>
            ))}
          </ul>
        )}

        <button className="card__cta" disabled={status !== 'idle'} onClick={handleAdd}>
          {LABELS[status === 'idle' ? 'add' : status]}
        </button>
      </div>
    </article>
  )
}
