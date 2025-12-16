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

// Função auxiliar v2.0: Mais inteligente para distinguir Qtd de Atributo
function extrairDados(linha: string): { quantidade: number, nomeLimpo: string } {
    // 1. Definição do que NÃO É quantidade (blacklist)
    const regexAtributos = /\d+\s*(fls|folhas|cores|g|kg|ml|mm|cm|m|gramas)\b/gi;

    // 2. Definição do que É quantidade explicitamente (whitelist)
    const regexQtdExplicita = /(\d+)\s*(unid|un|cx|caixa|pct|pacote|peça|pç|x)\b/i;

    let quantidade = 1;
    let nomeLimpo = linha;

    // ESTRATÉGIA 1: Procurar quantidade explícita ("2 unid", "3x")
    const matchExplicito = linha.match(regexQtdExplicita);
    if (matchExplicito && matchExplicito[1]) {
        quantidade = parseInt(matchExplicito[1], 10);
        // Removemos a parte da quantidade do texto para não atrapalhar a busca
        nomeLimpo = nomeLimpo.replace(regexQtdExplicita, '');
    } 
    // ESTRATÉGIA 2: Se não achou explícito, vê se a linha COMEÇA com um número solto
    else {
        const matchInicio = linha.match(/^(\d+)\s+/);
        if (matchInicio && matchInicio[1]) {
            const numero = parseInt(matchInicio[1], 10);
            
            // Verificamos se esse número inicial é um atributo proibido
            const ehAtributo = linha.match(/^(\d+)\s*(fls|folhas|cores|g|kg|ml)/i);
            
            if (!ehAtributo) {
                // Se não for atributo (tipo folhas), então é quantidade!
                quantidade = numero;
                nomeLimpo = nomeLimpo.replace(/^(\d+)\s+/, '');
            }
        }
    }

    // 3. Limpeza Geral: Removemos atributos numéricos e lixo para facilitar o Match
    nomeLimpo = nomeLimpo
        .replace(regexAtributos, '') // Remove "96 fls", "12 cores"
        .replace(/[*•\->;).,|O°º]/g, '') // Remove marcadores e pontuação
        .replace(/\b(unid|un|cx|caixa|pct|pacote|fls|folhas|grande|pequeno|escolar|infantil)\b/gi, '') // Palavras ruído
        .replace(/\s+/g, ' ') // Remove espaços duplos
        .trim();

    return { quantidade, nomeLimpo };
}

// ... (mantenha todas as importações e funções auxiliares lerTxt, lerPdf, lerImagem, extrairDados IGUAIS)

// --- FUNÇÃO PRINCIPAL REUTILIZÁVEL ---
// Agora ela aceita o caminho como parâmetro e RETORNA os dados
export async function processarOrcamento(caminhoDoArquivo: string) {
    console.log(`[ROTEADOR] Processando arquivo: ${caminhoDoArquivo}`);

    const extensao = path.extname(caminhoDoArquivo).toLowerCase();
    let fileContent: string;

    // (Lógica de seleção de motor continua igual...)
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
        // Se der erro, repassamos para quem chamou a função
        throw error;
    }

    // (Lógica de processamento continua igual...)
    const productNames = fileContent.split('\n')
                              .map(line => line.trim()) 
                              .filter(line => line.length > 0) 
                              .filter(line => !line.startsWith('--')); 

    // Carregar produtos (continua igual...)
    const allProducts: Product[] = await listProducts();
    const productNamesFromDb = allProducts.map(p => p.name);

    const resultados: OrcamentoItem[] = [];
    let precoTotal = 0;
    const confidenceThreshold = 0.3;

    // Loop de Fuzzy Match (continua igual...)
    for (const linhaSuja of productNames) {
        const { quantidade, nomeLimpo } = extrairDados(linhaSuja);
        if (nomeLimpo.length < 3) continue;

        const bestMatch = stringSimilarity.findBestMatch(nomeLimpo, productNamesFromDb);
        const bestRating = bestMatch.bestMatch.rating;
        const bestTarget = bestMatch.bestMatch.target;

        if (bestRating > confidenceThreshold) {
            const produto = allProducts.find(p => p.name === bestTarget);
            if (produto) {
                const precoTotalItem = produto.price * quantidade;
                resultados.push({
                    nomeBuscado: linhaSuja, 
                    encontrado: true,
                    produto: { id: produto.id, nome: produto.name, preco: precoTotalItem } // Preço total do item
                });
                precoTotal += precoTotalItem;
            }
        } else {
             resultados.push({ nomeBuscado: linhaSuja, encontrado: false });
        }
    }
    
    // --- MUDANÇA FINAL: RETORNAR O RESULTADO ---
    // Em vez de só imprimir, retornamos um objeto
    return {
        itens: resultados,
        total: precoTotal
    };
}

// --- CHECAGEM PARA RODAR NO TERMINAL ---
// Se este arquivo for executado diretamente (não importado), roda a lógica do terminal
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const arquivo = process.argv[2];
    if (arquivo) {
        processarOrcamento(arquivo)
            .then(resultado => {
                console.log('--- ORÇAMENTO VIA TERMINAL ---');
                console.log(JSON.stringify(resultado, null, 2)); // Mostra o JSON bonito
            })
            .catch(console.error)
            .finally(() => disconnectDb());
    }
}