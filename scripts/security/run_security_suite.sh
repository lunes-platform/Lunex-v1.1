#!/bin/bash

# 🛡️ LUNEX SECURITY CHECK SUITE
# Script automatizado para pré-validação de segurança antes do deploy/commit.

echo "🔒 Iniciando Verificação de Segurança Lunex..."
echo "==============================================="

# 1. Dependency Audit
echo "📦 [1/4] Verificando Dependências (Cargo Audit)..."
# Requer: cargo install cargo-audit
if command -v cargo-audit &> /dev/null; then
    cargo audit
    if [ $? -eq 0 ]; then
        echo "✅ Dependências OK"
    else
        echo "⚠️ Vulnerabilidades encontradas em dependências!"
    fi
else
    echo "⚠️ cargo-audit não instalado. Pulando. (Recomendado: cargo install cargo-audit)"
fi

echo "-----------------------------------------------"

# 2. Formatação e Linting (Ink! Best Practices)
echo "🧹 [2/4] Verificando Linting e Formatação..."
cargo fmt --all -- --check
if [ $? -eq 0 ]; then
    echo "✅ Código formatado corretamente"
else
    echo "⚠️ Problemas de formatação detectados!"
fi

# Aqui poderia entrar o clippy com regras específicas para ink!
# cargo clippy -- -D warnings

echo "-----------------------------------------------"

# 3. Testes Unitários de Segurança
echo "🧪 [3/4] Rodando Testes de Segurança Específicos..."
# Executa todos os testes unitários (incluindo security e openzeppelin)
cargo test 2>&1 | tee /tmp/cargo_test_output.txt
TEST_RESULT=${PIPESTATUS[0]}

if [ $TEST_RESULT -ne 0 ]; then
    echo "❌ FALHA: Alguns testes falharam!"
    cat /tmp/cargo_test_output.txt | grep -E "(FAILED|error\[)"
    exit 1
fi

echo "✅ Todos os testes passaram"

echo "-----------------------------------------------"

# 4. Dry-Run Check
echo "🚀 [4/4] Verificando Contract Build Size (Otimização)..."
cd uniswap-v2/contracts/factory && cargo contract build --release
# Check size loop for other contracts...

echo "==============================================="
echo "✅ SUITE DE SEGURANÇA FINALIZADA"
