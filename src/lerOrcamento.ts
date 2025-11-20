// --- MÓDULOS DE LEITURA ---
import fs from 'fs/promises';
import { PDFParse } from 'pdf-parse';
import path from 'path';
import mammoth from 'mammoth';

// --- (NOVO) MÓDULO DE SIMILARIDADE ---
import * as stringSimilarity from 'string-similarity';

// --- MÓDULOS DO BANCO ---
// (NOVO) Importamos 'listProducts' e 'Product'
import { disconnectDb, listProducts, Product } from './database.js';

// --- INTERFACE (não muda) ---
interface OrcamentoItem {
    nomeBuscado: string;
    encontrado: boolean;
    produto?: {
        id: number;
        nome: string;
        preco: number;
    };
}

// --- NOSSOS "MOTORES" DE LEITURA (não mudam) ---
async function lerTxt(filePath: string): Promise<string> {
    console.log('[ROTEADOR] Usando o leitor de TXT...');
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        return fileContent;
    } catch (e) {
        console.error("Erro ao ler arquivo TXT:", e);
        throw new Error("Falha ao ler TXT.");
    }
}

async function lerPdf(filePath: string): Promise<string> {
    console.log('[ROTEADOR] Usando o leitor de PDF...');
    try {
        const fileBuffer = await fs.readFile(filePath);
        const parser = new PDFParse({ data: fileBuffer });
        const textResult = await parser.getText();
        return textResult.text;
    } catch (e) {
        console.error("Erro ao ler arquivo PDF:", e);
        throw new Error("Falha ao ler PDF.");
    }
}

// "Motor" para ler arquivos .docx
async function lerDocx(filePath: string): Promise<string> {
    console.log('[ROTEADOR] Usando o leitor de DOCX...');
    try {
        // O mammoth lê o arquivo e extrai o texto puro
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value; // O texto está na propriedade .value
    } catch (e) {
        console.error("Erro ao ler arquivo DOCX:", e);
        throw new Error("Falha ao ler DOCX.");
    }
}

// --- FUNÇÃO PRINCIPAL (AGORA COM LÓGICA "FUZZY") ---
async function processarOrcamento() {
    // 1. PEGAR O NOME DO ARQUIVO DA LINHA DE COMANDO
    const caminhoDoArquivo = process.argv[2]; 
    if (!caminhoDoArquivo) {
        console.error("ERRO: Você precisa especificar um arquivo para ler.");
        console.log("Exemplo: npm run orcamento orcamento.pdf");
        return;
    }
    console.log(`[ROTEADOR] Processando arquivo: ${caminhoDoArquivo}`);

    // 2. ESCOLHER O "MOTOR" CORRETO
    const extensao = path.extname(caminhoDoArquivo).toLowerCase();
    let fileContent: string;
    try {
        if (extensao === '.txt') {
            fileContent = await lerTxt(caminhoDoArquivo);
        } else if (extensao === '.pdf') {
            fileContent = await lerPdf(caminhoDoArquivo);
        } else if (extensao === '.docx'){
            fileContent = await lerDocx(caminhoDoArquivo);
        } else {
            throw new Error(`Formato de arquivo não suportado: ${extensao}`);
        }
    } catch (error) {
        if (error instanceof Error) {
            console.error(`[ROTEADOR] Falha ao processar o arquivo: ${error.message}`);
        }
        return; 
    }

    // 3. PROCESSAR CONTEÚDO (limpeza não muda)
    console.log(`[PROCESSADOR] Texto extraído, processando ${fileContent.split('\n').length} linhas...`);
    const productNames = fileContent.split('\n')
                              .map(line => line.trim()) 
                              .filter(line => line.length > 0) 
                              .filter(line => !line.startsWith('--')); 
    
    console.log(`[PROCESSADOR] Itens encontrados (limpos): ${productNames.join(', ')}`);

    // --- (NOVO) 4. LÓGICA DE BUSCA INTELIGENTE ---
    console.log("[FUZZY] Carregando produtos do banco para comparação...");
    
    // a. Pegamos TODOS os produtos do banco (SÓ UMA VEZ)
    const allProducts: Product[] = await listProducts();
    // b. Criamos um array simples só com os nomes
    const productNamesFromDb = allProducts.map(p => p.name);

    if (productNamesFromDb.length === 0) {
        console.error("[FUZZY] ERRO: Nenhum produto cadastrado no banco. Rode `npm run dev` primeiro.");
        return;
    }
    console.log(`[FUZZY] Comparando ${productNames.length} itens contra ${productNamesFromDb.length} produtos do banco.`);

    const resultados: OrcamentoItem[] = [];
    let precoTotal = 0;
    const confidenceThreshold = 0.3; // Nosso "limite de confiança" (50%)

    // c. Para cada nome "sujo" do arquivo...
    for (const nomeSujo of productNames) {
        
        // d. ...encontramos o "alvo" mais parecido no banco
        const bestMatch = stringSimilarity.findBestMatch(nomeSujo, productNamesFromDb);
        const bestRating = bestMatch.bestMatch.rating;
        const bestTarget = bestMatch.bestMatch.target;

        // e. Se a similaridade for maior que nosso limite...
        if (bestRating > confidenceThreshold) {
            
            // f. ...buscamos o objeto completo do produto
            const produto = allProducts.find(p => p.name === bestTarget);

            if (produto) {
                console.log(`[FUZZY] ✔️  "${nomeSujo}" | similar a | "${produto.name}" (${(bestRating * 100).toFixed(0)}%)`);
                resultados.push({
                    nomeBuscado: nomeSujo,
                    encontrado: true,
                    produto: { id: produto.id, nome: produto.name, preco: produto.price },
                });
                precoTotal += produto.price;
            }
        } else {
            // Se a similaridade for muito baixa, desistimos
            console.log(`[FUZZY] ❌  "${nomeSujo}" | similar a | "${bestTarget}" (${(bestRating * 100).toFixed(0)}%) - BAIXA CONFIANÇA`);
            resultados.push({
                nomeBuscado: nomeSujo,
                encontrado: false,
            });
        }
    }
    
    // 5. EXIBIR RELATÓRIO (não muda)
    console.log('\n--- Resultado do Orçamento ---');
    resultados.forEach(item => {
        if (item.encontrado && item.produto) {
            console.log(`✔️ ${item.produto.nome} (Item: "${item.nomeBuscado}") | Preço: R$ ${item.produto.preco.toFixed(2)}`);
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
        console.error('[ROTEADOR] Ocorreu um erro fatal:', e);
    })
    .finally(async () => {
        await disconnectDb();
    });