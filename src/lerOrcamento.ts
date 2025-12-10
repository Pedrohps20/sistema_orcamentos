// --- MÓDULOS DE LEITURA ---
import fs from 'fs/promises';
import { PDFParse } from 'pdf-parse';
import path from 'path';
import mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';

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

// "Motor" para ler IMAGENS (ORC)
async function lerImagem(filePath: string): Promise<string> {
    console.log('[ROTEADOR] Usando o leitor de IMAGEM (OCR)...');
    console.log('[ORC] Inicializando motor (pode demorar na primeira vez)...');

    try {
        // Criamos o worker para português ('por')
        const worker = await createWorker('por');

        // Reconhecemos o texto da imagem
        const ret = await worker.recognize(filePath);
        const textoExtraido = ret.data.text;

        await worker.terminate(); // Desligamos o worker

        return textoExtraido;
    } catch (e) {
        console.error("Erro ao ler Imagem:", e);
        throw new Error("Falha ao ler Imagem.");
    }
}

// Função auxiliar para extrair quantidade e limpar o nome
function extrairDados(linha: string): { quantidade: number, nomeLimpo: string } {
    // 1. Tenta encontrar padrões de quantidade (ex: "2 unid", "01 caderno", "2x")
    const regexQuantidade = /(\d+)\s*(unid|un|cx|caixa|pct|pacote|fls|folhas|x)?/i;
    const match = linha.match(regexQuantidade);

    let quantidade = 1; // Se não achar número, assume 1
    if (match && match[1]) {
        quantidade = parseInt(match[1], 10);
    }

    // 2. Limpa o nome do produto (remove o número e palavras inúteis)
    let nomeLimpo = linha
        .replace(regexQuantidade, '') // Remove a quantidade
        .replace(/[*•\->;).,|O°º]/g, '') // Remove caracteres especiais e marcadores
        .replace(/\b(unid|un|cx|caixa|pct|pacote|fls|folhas|grande|pequeno|escolar|infantil)\b/gi, '')
        .replace(/\s+/g, ' ') // Remove espaços duplos
        .trim(); 

    return { quantidade, nomeLimpo };
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
        } else if (['.png', '.jpg', '.jpeg'].includes(extensao)) {
            fileContent = await lerImagem(caminhoDoArquivo);
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

    // c. Para cada linha "suja" do arquivo...
    for (const linhaSuja of productNames) {
        
        // --- (NOVO) Usamos nossa função para separar Qtd e Nome ---
        const { quantidade, nomeLimpo } = extrairDados(linhaSuja);

        // Se o nome ficou vazio ou muito curto (era só sujeira), pula
        if (nomeLimpo.length < 3) continue;

        // d. Buscamos o "alvo" mais parecido no banco USANDO O NOME LIMPO
        const bestMatch = stringSimilarity.findBestMatch(nomeLimpo, productNamesFromDb);
        const bestRating = bestMatch.bestMatch.rating;
        const bestTarget = bestMatch.bestMatch.target;

        // e. Se a similaridade for boa (maior que 30%)...
        if (bestRating > confidenceThreshold) {
            
            const produto = allProducts.find(p => p.name === bestTarget);

            if (produto) {
                // Calculamos o preço total (Preço x Quantidade)
                const precoTotalItem = produto.price * quantidade;
                
                console.log(`[FUZZY] ✔️  "${nomeLimpo}" (Qtd: ${quantidade}) -> "${produto.name}" (${(bestRating * 100).toFixed(0)}%)`);
                
                resultados.push({
                    nomeBuscado: linhaSuja, 
                    encontrado: true,
                    produto: { 
                        id: produto.id, 
                        nome: produto.name, 
                        preco: precoTotalItem // Salvamos o preço já multiplicado!
                    },
                });
                precoTotal += precoTotalItem;
            }
        } else {
            console.log(`[FUZZY] ❌  "${nomeLimpo}" -> "${bestTarget}" (${(bestRating * 100).toFixed(0)}%) - REJEITADO`);
             resultados.push({
                nomeBuscado: linhaSuja,
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