import { addProduct, listProducts, disconnectDb } from './database.js';

// FUnção principal que vai ordar a lógica do nosso sistema
async function main() {
    console.log('--- Sistema de Gerenciamento de preços (POPULANDO BANCO) ---');

    //1. Cadastrar produtos (para garantir que temos dados)
    try { 
        await addProduct('Caneta', 2.50);
        await addProduct('Caderno', 15.90);
        await addProduct('Mochila', 129.90);
    } catch (e) {
        // Ignoramos erros, eles já foram logados no database.ts
    }

    //2. Listar todos os produtos cadastrados
    console.log('\n--- Produtos Cadastrados no Banco ---');
    const allProducts = await listProducts();
    
    allProducts.forEach(p => {
        console.log(`ID: ${p.id} | Nome: ${p.name} | Preço: R$ ${p.price.toFixed(2)}`);
    });
    console.log('------------------------');
}

main()
.catch(e => {
    console.error('Ocorreu um erro fatal: ', e);
})
.finally(async () => {
    //No final, garantimos que a conexão com o banco seja fechada
    await disconnectDb();
});