// 앱의 저장소(IndexedDB의 'health-log')를 화면을 거치지 않고 바로 읽고 쓴다.
// 값이 정말 저장됐는지 볼 때와, 화면으로 만들기 번거로운 상태(3주 전에 한 백업, 2년 치 체중 기록)를 넣을 때 쓴다.
// 앱이 저장소를 만든 뒤에(화면을 한 번 연 뒤에) 써야 한다.
// 이렇게 넣은 값은 열려 있는 화면이 알아채지 못하므로, 넣은 뒤에는 page.reload()로 다시 연다.

const DB_NAME = 'health-log'

/** 테이블(store)에서 키가 key인 줄. 없으면 null */
export function readRow(page, store, key) {
  return page.evaluate(
    ({ name, store, key }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(name)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const idb = open.result
          const get = idb.transaction(store).objectStore(store).get(key)
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            idb.close()
            resolve(get.result ?? null)
          }
        }
      }),
    { name: DB_NAME, store, key },
  )
}

/** 여러 테이블에 줄을 넣는다(같은 키가 있으면 바꾼다). rows는 { 테이블: [줄, ...] } */
export function putRows(page, rows) {
  return page.evaluate(
    ({ name, rows }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(name)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const idb = open.result
          const stores = Object.keys(rows)
          const tx = idb.transaction(stores, 'readwrite')
          for (const store of stores) for (const row of rows[store]) tx.objectStore(store).put(row)
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            idb.close()
            resolve()
          }
        }
      }),
    { name: DB_NAME, rows },
  )
}

/** 이미 있는 줄의 일부 값만 바꾼다. keys에 든 키마다 patch를 덮어쓰고, 없는 키가 있으면 실패한다. */
export function patchRows(page, store, keys, patch) {
  return page.evaluate(
    ({ name, store, keys, patch }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(name)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const idb = open.result
          const tx = idb.transaction(store, 'readwrite')
          const table = tx.objectStore(store)
          for (const key of keys) {
            const get = table.get(key)
            get.onsuccess = () => {
              if (get.result === undefined) {
                reject(new Error(`${store}에 ${key} 줄이 없음`))
                tx.abort()
              } else table.put({ ...get.result, ...patch })
            }
          }
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            idb.close()
            resolve()
          }
        }
      }),
    { name: DB_NAME, store, keys, patch },
  )
}

/** 테이블을 비운다. */
export function clearStores(page, stores) {
  return page.evaluate(
    ({ name, stores }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(name)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const idb = open.result
          const tx = idb.transaction(stores, 'readwrite')
          for (const store of stores) tx.objectStore(store).clear()
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            idb.close()
            resolve()
          }
        }
      }),
    { name: DB_NAME, stores },
  )
}
