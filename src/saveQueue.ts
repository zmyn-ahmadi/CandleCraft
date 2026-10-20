type Listener = { resolve: () => void; reject: (reason: unknown) => void }
type Pending<T> = { data: T; listeners: Listener[] }

export function createSaveQueue<T>(persist: (data: T) => Promise<void>) {
  let pending: Pending<T> | null = null
  let writing = false

  async function drain(): Promise<void> {
    if (writing) return
    writing = true
    while (pending) {
      const current = pending
      pending = null
      try {
        await persist(current.data)
        current.listeners.forEach(listener => listener.resolve())
      } catch (error) {
        current.listeners.forEach(listener => listener.reject(error))
      }
    }
    writing = false
  }

  return (data: T): Promise<void> => new Promise((resolve, reject) => {
    if (pending) {
      pending.data = data
      pending.listeners.push({ resolve, reject })
    } else pending = { data, listeners: [{ resolve, reject }] }
    void drain()
  })
}
