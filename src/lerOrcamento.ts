// --- MÓDULOS DE LEITURA ---
import fs from 'fs/promises';
import { PDFParse } from 'pdf-parse';
import path from 'path';
import mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';

// --- MÓDULO DE SIMILARIDADE ---
import * as stringSimilarity from 'string-similarity';

// --- MÓDULOS DO BANCO ---
import { disconnectDb, listProducts, Product } from './database.js';

// --- INTERFACE ---
interface OrcamentoItem {
    nomeBuscado: string;
    encontrado: boolean;
    produto?: {
        id: number;
        nome: string;
        preco: number;
    };
}

// --- CONFIGURAÇÃO DE IGNORADOS ---
// Palavras que, se aparecerem na linha, indicam que NÃO é um produto (Cabeçalhos, Avisos, etc)
const PALAVRAS_IGNORADAS = [
    'ensino', 'fundamental', 'médio', 'série', 'ano', 'lista', 'material', 'escolar', 
    'individual', 'coletivo', 'uso', 'obrigatório', 'paulo', 'educação', 'infantil',
    'total', 'imprimir', 'salvar', 'atenção', 'importante', 'livro', 'didático', 'bilíngue'
];

// --- NOSSOS "MOTORES" DE LEITURA ---

async function lerTxt(filePath: string): Promise<string> {
    console.log('[ROTEADOR] Usando o leitor de TXT...');
    try {
        return await fs.readFile(filePath, 'utf-8');
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

async function lerDocx(filePath: string): Promise<string> {
    console.log('[ROTEADOR] Usando o leitor de DOCX...');
    try {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
    } catch (e) {
        console.error("Erro ao ler arquivo DOCX:", e);
        throw new Error("Falha ao ler DOCX.");
    }
}

async function lerImagem(filePath: string): Promise<string> {
    console.log('[ROTEADOR] Usando o leitor de IMAGEM (OCR)...');
    console.log('[ORC] Inicializando motor (pode demorar na primeira vez)...');
    try {
        const worker = await createWorker('por');
        const ret = await worker.recognize(filePath);
        const textoExtraido = ret.data.text;
        await worker.terminate();
        return textoExtraido;
    } catch (e) {
        console.error("Erro ao ler Imagem:", e);
        throw new Error("Falha ao ler Imagem.");
    }
}

// --- FUNÇÃO DE LIMPEZA INTELIGENTE v3.0 (HARDCORE) ---
function extrairDados(linha: string): { quantidade: number, nomeLimpo: string, ignorar: boolean } {
    
    // 0. Pré-limpeza de marcadores de lista do OCR (*, -, +, >, o)
    // Removemos caracteres não alfanuméricos do INÍCIO da linha
    let linhaTratada = linha.replace(/^[\s*\-•+>_.)\]}]+/, '').trim();

    // 1. Verificar se é linha de cabeçalho/lixo
    const textoBaixo = linhaTratada.toLowerCase();
    
    // Se a linha for muito curta (< 4 letras) ou contiver palavras proibidas
    if (linhaTratada.length < 4 || PALAVRAS_IGNORADAS.some(p => textoBaixo.includes(p))) {
        return { quantidade: 0, nomeLimpo: '', ignorar: true };
    }

    // 2. Correção de OCR para números (Leet Speak)
    // Transforma "Ol caderno" em "01 caderno", "l caderno" em "1 caderno" NO INÍCIO
    if (/^[lI|]\s/.test(linhaTratada)) { // "l " ou "I " vira "1 "
        linhaTratada = '1 ' + linhaTratada.substring(2);
    } else if (/^Ol\s/.test(linhaTratada) || /^Ql\s/.test(linhaTratada)) { // "Ol " vira "01 "
        linhaTratada = '01 ' + linhaTratada.substring(3);
    }

    // 3. Lógica de Quantidade (Whitelist/Blacklist)
    const regexAtributos = /\d+\s*(fls|folhas|cores|g|kg|ml|mm|cm|m|gramas|b)\b/gi;
    const regexQtdExplicita = /(\d+)\s*(unid|un|cx|caixa|pct|pacote|peça|pç|x|pares|jogos|jg)\b/i;

    let quantidade = 1;
    let nomeLimpo = linhaTratada;

    const matchExplicito = linhaTratada.match(regexQtdExplicita);
    if (matchExplicito && matchExplicito[1]) {
        quantidade = parseInt(matchExplicito[1], 10);
        nomeLimpo = nomeLimpo.replace(regexQtdExplicita, '');
    } else {
        const matchInicio = linhaTratada.match(/^(\d+)\s+/);
        if (matchInicio && matchInicio[1]) {
            const numero = parseInt(matchInicio[1], 10);
            const ehAtributo = linhaTratada.match(/^(\d+)\s*(fls|folhas|cores|g|kg|ml|b)/i); // Adicionado 'b' para 6B
            if (!ehAtributo) {
                quantidade = numero;
                nomeLimpo = nomeLimpo.replace(/^(\d+)\s+/, '');
            }
        }
    }

    // 4. Limpeza Final do Nome
    nomeLimpo = nomeLimpo
        .replace(regexAtributos, '') 
        .replace(/[*•\->;).,|O°º"“”]/g, '') // Remove pontuação pesada
        .replace(/\b(unid|un|cx|caixa|pct|pacote|fls|folhas|grande|pequeno|escolar|infantil|azul|preta|color|lumi)\b/gi, '')
        .replace(/[0-9]/g, '') // Remove números soltos que sobraram no nome (ex: "Lápis 6B" -> "Lápis B")
        .replace(/\s+/g, ' ')
        .trim();

    return { quantidade, nomeLimpo, ignorar: false };
}

// --- FUNÇÃO PRINCIPAL ---
export async function processarOrcamento(caminhoDoArquivo: string) {
    console.log(`[ROTEADOR] Processando arquivo: ${caminhoDoArquivo}`);

    const extensao = path.extname(caminhoDoArquivo).toLowerCase();
    let fileContent: string;

    try {
        if (extensao === '.txt') fileContent = await lerTxt(caminhoDoArquivo);
        else if (extensao === '.pdf') fileContent = await lerPdf(caminhoDoArquivo);
        else if (extensao === '.docx') fileContent = await lerDocx(caminhoDoArquivo);
        else if (['.png', '.jpg', '.jpeg'].includes(extensao)) fileContent = await lerImagem(caminhoDoArquivo);
        else throw new Error(`Formato não suportado: ${extensao}`);
    } catch (error) {
        throw error;
    }

    // Carregar produtos do banco
    const allProducts: Product[] = await listProducts();
    const productNamesFromDb = allProducts.map(p => p.name);

    // Separar linhas
    const linhasBrutas = fileContent.split('\n')
                              .map(line => line.trim()) 
                              .filter(line => line.length > 0);

    const resultados: OrcamentoItem[] = [];
    let precoTotal = 0;
    const confidenceThreshold = 0.3; 

    // Loop Inteligente
    for (const linha of linhasBrutas) {
        // Extração de dados
        const { quantidade, nomeLimpo, ignorar } = extrairDados(linha);

        // Se for cabeçalho ou lixo, ignora sem nem tentar buscar
        if (ignorar || nomeLimpo.length < 3) continue;

        const bestMatch = stringSimilarity.findBestMatch(nomeLimpo, productNamesFromDb);
        const bestRating = bestMatch.bestMatch.rating;
        const bestTarget = bestMatch.bestMatch.target;

        if (bestRating > confidenceThreshold) {
            const produto = allProducts.find(p => p.name === bestTarget);
            if (produto) {
                const precoTotalItem = produto.price * quantidade;
                
                resultados.push({
                    nomeBuscado: linha, // Mostra a linha original para o usuário conferir
                    encontrado: true,
                    produto: { id: produto.id, nome: produto.name, preco: precoTotalItem }
                });
                precoTotal += precoTotalItem;
            }
        } else {
            // Se não encontrou, adicionamos na lista (para o usuário saber que faltou)
            resultados.push({ nomeBuscado: linha, encontrado: false });
        }
    }
    
    return {
        itens: resultados,
        total: precoTotal
    };
}

// Compatibilidade com terminal
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const arquivo = process.argv[2];
    if (arquivo) {
        processarOrcamento(arquivo)
            .then(resultado => console.log(JSON.stringify(resultado, null, 2)))
            .catch(console.error)
            .finally(() => disconnectDb());
    }
}