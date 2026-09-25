const mode = process.argv[2] || 'success'

console.log('fixture started')

if (mode === 'sleep') {
    setTimeout(() => {
        console.log('fixture finished')
        process.exit(0)
    }, 10000)
} else if (mode === 'error') {
    console.error('fixture failed')
    process.exit(2)
} else {
    console.log('fixture finished')
    process.exit(0)
}
