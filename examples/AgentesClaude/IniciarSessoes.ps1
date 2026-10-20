<#
  IniciarSessoes.ps1 - abre uma equipe de agentes do Claude Code numa pasta.

  Uso pelo TermGrid (um painel por papel):
    IniciarSessoes.ps1 -Papel <papel> -Pasta <pasta> [-Nova]

  Uso avulso (abre todos os papéis no Windows Terminal, ou uma janela por papel):
    IniciarSessoes.ps1 [-Pasta <pasta>] [-Nova]

  Estrutura:
    agentes\orquestrador\      instrucoes.md, modelo.txt, tools-permitidas.txt, tools-bloqueadas.txt
    agentes\subagentes\<papel> instrucoes.md, modelo.txt, tools.txt, bash-permitidos.txt (opcional)

  Sessões: o ID de cada sessão é guardado por pasta + papel em sessoes\ e
  retomado com --resume. -Nova ignora as sessões salvas e cria novas.
  Requer Claude Code 2.1.234+ (flags --name/--settings, ListAgents/SendMessage).
#>
param(
    [string]$Pasta = (Get-Location).Path,
    [string]$Papel,
    [switch]$Nova
)

$ErrorActionPreference = 'Stop'
# "C:\proj\" quebraria as aspas na linha de comando dos painéis; a raiz ("D:\") fica como está.
if ($Pasta.Length -gt 3) { $Pasta = $Pasta.TrimEnd('\') }
$dirAgentes = Join-Path $PSScriptRoot 'agentes'
$dirSessoes = Join-Path $PSScriptRoot 'sessoes'

function Ler-Linhas([string]$arquivo) {
    if (-not (Test-Path -LiteralPath $arquivo)) { return @() }
    Get-Content -LiteralPath $arquivo -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith('#') }
}

function Ler-Texto([string]$arquivo, [string]$padrao = '') {
    if (-not (Test-Path -LiteralPath $arquivo)) { return $padrao }
    (Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8).Trim()
}

function Listar-Papeis {
    $sub = Join-Path $dirAgentes 'subagentes'
    $workers = if (Test-Path -LiteralPath $sub) {
        Get-ChildItem -LiteralPath $sub -Directory | Sort-Object Name | ForEach-Object Name
    } else { @() }
    @('orquestrador') + @($workers)
}

# Hash do caminho completo: pastas diferentes nunca compartilham sessões.
$md5 = [System.Security.Cryptography.MD5]::Create()
$hashPasta = -join ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($Pasta.ToLower()))[0..3] |
    ForEach-Object { $_.ToString('x2') })
# Sufixo dos nomes das sessões (ex.: leitor-1a2b): com duas equipes abertas, nomes iguais
# deixariam o SendMessage ambíguo. O TermGrid passa um por workspace em CLAUDE_EQUIPE;
# sem ele, vale o hash da pasta.
$sufixoEquipe = if ($env:CLAUDE_EQUIPE -match '^[A-Za-z0-9]{1,12}$') { $env:CLAUDE_EQUIPE } else { $hashPasta.Substring(0, 4) }
function Nome-Sessao([string]$papel) { "$papel-$sufixoEquipe" }

# Uma sessão por pasta + papel: --resume se já existe, senão --session-id novo.
function Args-Sessao([string]$papel) {
    New-Item -ItemType Directory -Force -Path $dirSessoes | Out-Null
    # Nome legível (últimos 40 caracteres) + hash do caminho completo.
    $legivel = ($Pasta.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
    if ($legivel.Length -gt 40) { $legivel = $legivel.Substring($legivel.Length - 40).Trim('-') }
    $arquivo = Join-Path $dirSessoes "$legivel-$hashPasta-$papel.txt"
    $projetos = Join-Path $env:USERPROFILE '.claude\projects'

    if (-not $Nova -and (Test-Path -LiteralPath $arquivo)) {
        $id = ([string](Get-Content -LiteralPath $arquivo -Raw)).Trim()
        if ($id -match '^[0-9a-fA-F-]{36}$') {
            $existe = Get-ChildItem -LiteralPath $projetos -Filter "$id.jsonl" -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($existe) { return @('--resume', $id) }
        }
    }
    $id = [guid]::NewGuid().ToString()
    Set-Content -LiteralPath $arquivo -Value $id -Encoding ASCII
    @('--session-id', $id)
}

$nomesEquipe = (Listar-Papeis | ForEach-Object { "'$(Nome-Sessao $_)'" }) -join ', '
$blocoEquipe = @"

COMO TRABALHAR EM EQUIPE:
- Você faz parte de uma equipe de sessões do Claude Code abertas na mesma pasta. Os outros papéis já estão abertos como sessões próprias: fale com eles somente por SendMessage. Nunca crie subagentes (ferramenta Agent/Task) para fazer o trabalho deles.
- Nomes das sessões desta equipe: $nomesEquipe. Quando as instruções citarem um papel (por exemplo 'leitor'), use o nome completo com o sufixo -$sufixoEquipe no SendMessage. Sessões com outro sufixo são de outras equipes: ignore-as.
- Use a ferramenta ListAgents para ver quais sessões estão ativas e SendMessage para falar com elas pelo nome. Se o nome aparecer repetido no ListAgents, use o nome com o [ref] mostrado ao lado.
- Em cada mensagem diga exatamente o que quer e o formato da resposta; as outras sessões não conhecem o seu contexto.
- Depois de enviar, aguarde a resposta chegar como mensagem. Não repita o envio.
"@

$blocoSubagente = @"
- Quando receber um pedido de outra sessão, faça o trabalho e responda a quem enviou usando SendMessage, com o resultado completo na mesma mensagem. A resposta escrita só no seu terminal não chega a ninguém.
- Não inicie conversa por conta própria; só responda aos pedidos que receber.
- Decidir é do orquestrador: traga fatos, opções e achados, sem tomar decisões fora do pedido.
"@

# ---------- Modo painel: uma sessão (usado pelo TermGrid) ----------
if ($Papel) {
    if ($Papel -notmatch '^[A-Za-z0-9_][A-Za-z0-9_-]*$') { throw "Papel inválido: $Papel" }
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
        throw 'Claude Code não encontrado no PATH. Instale em https://docs.claude.com/claude-code'
    }
    Set-Location -LiteralPath $Pasta

    # Permite receber mensagens de outras sessões (SendMessage).
    # Um arquivo por papel: os painéis sobem ao mesmo tempo e não disputam o mesmo arquivo.
    $settings = Join-Path $env:TEMP "claude-sessoes-settings-$Papel.json"
    Set-Content -LiteralPath $settings -Value '{"crossSessionInbound":"accept"}' -Encoding ASCII

    $argsClaude = @('--name', (Nome-Sessao $Papel), '--settings', $settings)

    if ($Papel -eq 'orquestrador') {
        $dir = Join-Path $dirAgentes 'orquestrador'
        $modelo = Ler-Texto (Join-Path $dir 'modelo.txt') 'opus'
        $instrucoes = (Ler-Texto (Join-Path $dir 'instrucoes.md')) + $blocoEquipe
        $permitidas = @(Ler-Linhas (Join-Path $dir 'tools-permitidas.txt')) + @('ListAgents', 'SendMessage')
        # Os outros papéis são sessões peer: subagentes em segundo plano duplicariam o trabalho.
        $bloqueadas = @(Ler-Linhas (Join-Path $dir 'tools-bloqueadas.txt')) + @('Agent', 'Task')
        $permitidas = $permitidas | Where-Object { $_ -notin 'Agent', 'Task' }
    } else {
        $dir = Join-Path $dirAgentes "subagentes\$Papel"
        if (-not (Test-Path -LiteralPath $dir)) { throw "Papel não encontrado: $dir" }
        $modelo = Ler-Texto (Join-Path $dir 'modelo.txt') 'haiku'
        $instrucoes = (Ler-Texto (Join-Path $dir 'instrucoes.md')) + $blocoEquipe + $blocoSubagente
        $tools = @(Ler-Linhas (Join-Path $dir 'tools.txt'))

        # Bash fica restrito a comandos de leitura do git + os liberados em bash-permitidos.txt.
        $permitidas = foreach ($t in $tools) {
            if ($t -eq 'Bash') {
                'Bash(git status)', 'Bash(git diff:*)', 'Bash(git log:*)'
                Ler-Linhas (Join-Path $dir 'bash-permitidos.txt')
            } else { $t }
        }
        $permitidas = @($permitidas) + @('ListAgents', 'SendMessage')

        $sensiveis = 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'
        $bloqueadas = $sensiveis | Where-Object { $tools -notcontains $_ }
    }

    $argsClaude += @('--model', $modelo)
    if ($instrucoes.Trim()) {
        # Aspas duplas viram simples para não quebrar a linha de comando no Windows.
        $argsClaude += @('--append-system-prompt', ($instrucoes -replace '"', "'"))
    }
    if ($permitidas) { $argsClaude += @('--allowedTools', ($permitidas -join ',')) }
    if ($bloqueadas) { $argsClaude += @('--disallowedTools', (@($bloqueadas) -join ',')) }
    $argsClaude += Args-Sessao $Papel

    Write-Host "[$Papel] modelo $modelo em $Pasta" -ForegroundColor Cyan
    & claude @argsClaude
    return
}

# ---------- Modo principal: abre todos os papéis ----------
if (-not (Test-Path -LiteralPath (Join-Path $dirAgentes 'orquestrador'))) {
    throw "Pasta agentes\orquestrador não encontrada em $PSScriptRoot"
}
if (-not (Test-Path -LiteralPath $Pasta -PathType Container)) { throw "Pasta não encontrada: $Pasta" }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    throw 'Claude Code não encontrado no PATH. Instale em https://docs.claude.com/claude-code'
}
$papeis = Listar-Papeis
$extra = if ($Nova) { ' -Nova' } else { '' }
function Comando([string]$p) {
    "powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Papel $p -Pasta `"$Pasta`"$extra"
}

if (Get-Command wt -ErrorAction SilentlyContinue) {
    $partes = @("-w new new-tab --title $($papeis[0]) $(Comando $papeis[0])")
    for ($i = 1; $i -lt $papeis.Count; $i++) {
        $split = if ($i -eq 1) { '-V' } else { '-H' }
        $partes += "split-pane $split --title $($papeis[$i]) $(Comando $papeis[$i])"
    }
    $partes += 'focus-tab -t 0'
    Start-Process wt -ArgumentList ($partes -join ' ; ')
} else {
    foreach ($p in $papeis) {
        $argumentos = (Comando $p) -replace '^powershell ', ''
        Start-Process powershell -ArgumentList $argumentos
    }
}
