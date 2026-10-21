export function generationMemoryDatabase() {
  let documents = new Map(); let tail = Promise.resolve();
  return {
    get: path => structuredClone(documents.get(path)),
    set: (path, data) => documents.set(path, structuredClone(data)),
    transaction(run) {
      const task = tail.then(async () => {
        const staged = structuredClone(documents);
        const result = await run({ get: async path => structuredClone(staged.get(path)), set: (path, value) => staged.set(path, structuredClone(value)) });
        documents = staged; return result;
      }); tail = task.catch(() => {}); return task;
    },
  };
}
