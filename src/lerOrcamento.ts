import fs from 'fs/promises'; // Ainda precisamos do 'fs' para ler o arquivo
import pdfParse from 'pdf-parse' // 1. Importamos a nova biblioteca (com a sintaxe de namespace)
import { findProductByName, disconnectDb } from './database.js';

// Interface para definir como será nosso resultado (continua igual)
interface OrcamentoItem {
    nomeBuscado: string;
    encontrado: boolean;
    produto?: {
        id: number;
        nome: string;
        preco: number;
    };
}

// Função principal deste SCRIPT
async function processarOrcamento() {
    // 2. Mudamos o nome do arquivo que queremos ler
    const caminhoDoArquivo = 'orcamento.pdf'; 
    console.log(`[ORÇAMENTO PDF] Lendo arquivo: ${caminhoDoArquivo}`);

    // --- ESTE BLOCO MUDOU ---
    // 1. LER O ARQUIVO (AGORA COMO PDF)
    let fileContent: string; // O resultado final (o texto puro)
    try {
        // Lemos o arquivo PDF como um 'buffer' (dados binários)
        // Note que removemos o 'utf-8'
        const fileBuffer = await fs.readFile(caminhoDoArquivo); 

        // Usamos o pdf-parse para ler o buffer
        const data = await pdfParse(fileBuffer)
        
        // O texto extraído está em 'data.text'
        fileContent = data.text;

    } catch (error) {
        console.error(`[ORÇAMENTO PDF] ERRO: Não foi possível ler o arquivo PDF.`);
        console.error(error);
        return; // Sai do script
    }
    // --- FIM DO BLOCO QUE MUDOU ---


    // 2. PROCESSAR CONTEÚDO (DAQUI PARA BAIXO, NADA MUDA!)
    console.log(`[ORÇAMENTO PDF] Texto extraído, processando ${fileContent.split('\n').length} linhas...`);
    
    const productNames = fileContent.split('\n')
                              .map(line => line.trim()) // Limpa espaços
                              .filter(line => line.length > 0); // Remove linhas em branco
    
    console.log(`[ORÇAMENTO PDF] Itens encontrados: ${productNames.join(', ')}`);

    // 3. BUSCAR PREÇOS NO BANCO
    const resultados: OrcamentoItem[] = [];
    let precoTotal = 0;

    for (const nome of productNames) {
        const produto = await findProductByName(nome); 

        if (produto) {
            resultados.push({
                nomeBuscado: nome,
                encontrado: true,
                produto: { id: produto.id, nome: produto.name, preco: produto.price },
            });
            precoTotal += produto.price;
        } else {
            resultados.push({
                nomeBuscado: nome,
                encontrado: false,
            });
        }
    }
    
    // 4. EXIBIR RELATÓRIO
    console.log('\n--- Resultado do Orçamento (PDF) ---');
    resultados.forEach(item => {
        if (item.encontrado && item.produto) {
            console.log(`✔️ ${item.produto.nome} | Preço: R$ ${item.produto.preco.toFixed(2)}`);
        } else {
            console.log(`❌ Não encontrado: "${item.nomeBuscado}"`);
        }
    });
    console.log('------------------------------');
    console.log(`TOTAL DO ORÇAMENTO: R$ ${precoTotal.toFixed(2)}`);
    console.log('------------------------------');
}

// --- Ponto de entrada do Script ---
processarOrcamento()
    .catch(e => {
        console.error('[ORÇAMENTO PDF] Ocorreu um erro fatal:', e);
    })
    .finally(async () => {
        await disconnectDb();
    });










/*import fs from 'fs/promises'; // Módulo nativo do Node para ler arquivos
//Importamos SÓ o que precisamos do nosso database
import { findProductByName, disconnectDb } from './database.js';

//Interface para definir como será nosso resultado
interface OrcamentoItem {
    nomeBuscado: string;
    encontrado: boolean;
    produto?: {
        id: number;
        nome: string;
        preco: number;
    };
}

// FUnção principal deste SCRIPT
async function processarOrcamento() {
    const caminhoDoArquivo = 'lista_orcamento.txt'; // O arquivo .txt na raiz
    console.log(`[ORÇAMENTO] Lendo arquivo: ${caminhoDoArquivo}`);

    //1. Ler o ARQUIVO
    let fileContent: string;
    try {
        fileContent = await fs.readFile(caminhoDoArquivo, 'utf-8');
    } catch (error) {
        console.error(`[ORÇAMENTO] ERRO: Não foi possível ler o arquivo.`);
        console.error("Verifique se o arquivo 'lista_orcamento.txt' exoste na raiz do projeto.");
        return; // Sai do script
    }

    //2. PROCESSAR CONTEÚDO
    // Quebra o arquivo em linhas, remove espaços e linhas em branco
    const productNames = fileContent.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    console.log(`[ORÇAMENTO] Itens encontrados no arquivo: ${productNames.join(', ')}`);

    //3. BUSCAR PREÇOS NO BANCO
    const resultados: OrcamentoItem[] = [];
    let precoTotal = 0;

    // Usamos 'for... of' para poder usar 'await' dentro dele
    for (const nome of productNames) {
        const produto = await findProductByName(nome); // Usamos a função do database.ts

        if (produto) {
            //Produto ENCONTRADO
            resultados.push({
                nomeBuscado: nome,
                encontrado: true,
                produto: {
                    id: produto.id,
                    nome: produto.name,
                    preco: produto.price,
                },
            });
            precoTotal += produto.price; // Adiciona o total
        } else{
            // Produto NÃO ENCONTRADO
            resultados.push({
                nomeBuscado: nome,
                encontrado: false,
            });
        }
    }

    //4. EXIBIR RELATÓRIO
    console.log('\n-- RESULTADO DO ORÇAMENTO --');
    resultados.forEach(item => {
        if (item.encontrado && item.produto) {
            console.log(`✔️ ${item.produto.nome} | Preço: R$ ${item.produto.preco.toFixed(2)}`);
        } else {
            console.log(`❌ Não encontrado: "${item.nomeBuscado}"`);
        }
    });
    console.log('---------------------------');
    console.log(`VALOR TOTAL DO ORÇAMENTO: R$ ${precoTotal.toFixed(2)}`);
    console.log('---------------------------');
}

// --- Ponto de entrada do Script ---
processarOrcamento()
    .catch(e => {
        console.error('[ORÇAMENTO] Ocorreu um erro fatal: ', e);
    })
    .finally(async () => {
        // ESSENCIAL: Todo script que usa banco deve fechar a conexão
        await disconnectDb();
    });

*/