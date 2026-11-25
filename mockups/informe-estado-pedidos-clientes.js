document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b))
    document.querySelectorAll('.escena').forEach((s) => s.classList.toggle('on', s.id === 'e-' + b.dataset.e))
  })
})
