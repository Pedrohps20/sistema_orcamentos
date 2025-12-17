import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { processarOrcamento } from './lerOrcamento.js'; // minha função

// Configurações básicas para lidar com caminhos no ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Habilita CORS (para o front-end poder chamar o back-end) e JSON
app.use(cors());
app.use(express.json());

// Configuração do Multer (Upload de Arquivos)
// Vamos salvar os arquivos temporariamente na pasta 'uploads'
const upload = multer({ 
    dest: 'uploads/',
    storage: multer.diskStorage({
        destination: 'uploads/',
        filename: (req, file, cb) => {
            // Mantém a extensão original (.pdf, .png, etc)
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const ext = path.extname(file.originalname);
            cb(null, file.fieldname + '-' + uniqueSuffix + ext);
        }
    })
});

// Cria a pasta 'uploads' se não existir
if (!fs.existsSync('uploads')){
    fs.mkdirSync('uploads');
}

// Servir arquivos estáticos (o nosso futuro Site/Frontend)
app.use(express.static('public'));

// --- ROTA DA API ---
// É aqui que o site vai mandar o arquivo
app.post('/api/orcamento', upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'Nenhum arquivo enviado.' });
            return; 
        }

        console.log(`[SERVER] Recebido arquivo: ${req.file.originalname}`);
        console.log(`[SERVER] Caminho temporário: ${req.file.path}`);

        // Chamamos a NOSSA função mágica!
        const resultado = await processarOrcamento(req.file.path);

        // Devolvemos o JSON para o site
        res.json(resultado);

        // Opcional: Deletar o arquivo depois de processar para não encher o disco
        // fs.unlinkSync(req.file.path); 

    } catch (error) {
        console.error('[SERVER] Erro ao processar:', error);
        res.status(500).json({ 
            error: 'Erro ao processar orçamento.',
            detalhes: error instanceof Error ? error.message : 'Erro desconhecido'
        });
    }
});

// Inicia o servidor
app.listen(port, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${port}`);
    console.log(`📂 Abra seu navegador para usar o sistema!`);
});