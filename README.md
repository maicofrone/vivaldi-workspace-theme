# Vivaldi Workspace Theme

Mod para o Vivaldi que **troca o tema automaticamente conforme o workspace**, com uma **transição suave** entre os temas e um **painel de configuração** dentro das próprias configurações do Vivaldi.

Testado no Vivaldi 8.3 (Linux/Arch).

## Recursos

- Um tema para cada workspace, escolhido num painel em **Configurações → Temas**
- Tema padrão para abas sem workspace (ou workspaces sem tema definido)
- Transição suave entre temas, incluindo a foto de fundo
- Duração ajustável (0,1 s a 3 s) e curva **Linear** ou **Suave**
- Sites abertos ficam fora da transição (vídeos não congelam)
- Configuração salva entre reinícios
- Painel em português ou inglês, seguindo o idioma da interface do Vivaldi
- Sem rede, sem dependências

## Arquivos

| Arquivo | O que é |
|---|---|
| `workspace-theme.js` | O mod (troca de tema + painel de configuração) |
| `instalar.sh` | Instala o mod e um hook do pacman que o reaplica após updates do Vivaldi |

## Instalação (Arch / CachyOS)

```bash
./instalar.sh
```

O script pede sudo porque:
- copia o mod para `/opt/vivaldi/resources/vivaldi/` e adiciona uma linha no `window.html`;
- cria `/usr/local/bin/vivaldi-mod-patch` e o hook `/etc/pacman.d/hooks/vivaldi-mods.hook`, que reaplicam o mod sempre que o pacman atualizar o Vivaldi.

Os arquivos ficam em `~/.local/share/vivaldi-mods`.

Depois:
1. Feche o Vivaldi por completo (Ctrl+Q) e abra de novo.
2. Abra **Configurações → Temas**. No topo aparece o painel **Tema por workspace** (*Workspace theme*).
3. Em **Agendamento de Temas** (*Theme Schedule*), na mesma página, deixe **Sem Agendamento** (*No Schedule*), senão ele troca o tema por cima do mod.

### Atualizar o mod

Depois de editar `workspace-theme.js`, copie para `~/.local/share/vivaldi-mods/` e rode:

```bash
sudo vivaldi-mod-patch
```

## Depurar

Abra `vivaldi://inspect/#apps` → **inspect** na janela do Vivaldi → console. Procure mensagens `[workspace-theme]`.

## Desinstalar

```bash
sudo rm /etc/pacman.d/hooks/vivaldi-mods.hook /usr/local/bin/vivaldi-mod-patch /opt/vivaldi/resources/vivaldi/workspace-theme.js
sudo pacman -S vivaldi   # restaura o window.html original
rm -r ~/.local/share/vivaldi-mods
```

## Limitações

- O tema do Vivaldi é global: com duas janelas em workspaces diferentes, vale o da janela em foco.
- Usa APIs internas do Vivaldi. Uma versão futura pode quebrar o mod; no pior caso ele simplesmente não faz nada.
- O instalador é para Arch/CachyOS (caminho `/opt/vivaldi` e hook do pacman). O `workspace-theme.js` em si funciona em qualquer sistema.
