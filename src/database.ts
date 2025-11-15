import { PrismaClient, Product } from '@prisma/client';

// Criamos a instância do Prisma Client que será usada em todo o projeto
const prisma = new PrismaClient();

//Função para adicionar um produto ao banco de dados
export async function addProduct(name: string, price: number): Promise<Product> {
    try {
        //O "await" faz o código esperar o banco de dados respodner
        const product = await prisma.product.create({
            data: {
                name: name,
                price: price,
            },
        });
        console.log(`[DB] Produto cadastrado: ${product.name} (R$ ${product.price.toFixed(2)})`);
        return product;
    } catch(e) {
        //O TypeScript reclama que o 'e' é 'unknown'. Precisamos verificar o tipo.
        if (e instanceof Error) {
            //Se for um erro do Prisma de "registro único duplicado"
            if ('code' in e && (e as any).code === 'p2002') {
                console.warn(`[DB] Produto já existe: ${name}. Ignorado.`);
                //Se o produto já existe, vamos buscá-lo e retorná-lo
                const existingProduct = await prisma.product.findUnique({ where: { name }});
                if (existingProduct) return existingProduct;
            }
        }
        // Se for outro erro, ou se a busca falhar, lançamos o erro
        throw e;
    }
}

//Função para listar todos os produtos
export async function listProducts(): Promise<Product[]> {
    const products = await prisma.product.findMany();
    return products;
}

//Função para buscar um produto pelo nome (vamos precisar dela em breve)
export async function findProductByName(name: string): Promise<Product | null> {
    const product = await prisma.product.findUnique({
        where: { name: name },
    });
    return product;
}

//Função para desconectar do banco
export async function disconnectDb() {
    await prisma.$disconnect();
}