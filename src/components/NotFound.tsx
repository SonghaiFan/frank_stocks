import { Link } from '@tanstack/react-router'

export function NotFound({ children }: { children?: React.ReactNode }) {
  return (
    <main className="error-screen">
      <p>{children || 'The page you are looking for does not exist.'}</p>
      <Link to="/">Start Over</Link>
    </main>
  )
}
