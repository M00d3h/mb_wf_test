integration with - codex, qwen code, mistral vibe, opencode

to do later - like canvas mode
html preview

reasoning effort for gptoss

claude --resume "thinking-preview-shimmer" 

model not sayiung downloaded if dropped into dir not downloaded from app even if name and provider correct

search bar in model library sometimes bugs and freezes

claude --resume 22f9ed9d-c898-4af9-a372-e04baa1cfd89

need for incomplete models to count mmproj as part of model - maybe add option to download mmproj pop up menu instead of up top hidden

claude --resume 22f9ed9d-c898-4af9-a372-e04baa1cfd89

option to launch local mcp server on boot
rocm/intel gpu stats, check linux ram cpu etc stats work
investigate gptoss ridiculous high tps speedd

claude --resume 922a374f-518d-43c9-8d95-0d88fc67a8f2

claude --resume df868748-0749-41da-9ec2-4e253b5f3d6d

look at making tps more accurate for vllm
port and ip in vllm models in dropdown showing full 192 ip even if not bound to 0.0.0.0
vllm models page laggy and makes fans spin up?
use default vscode font for code font. in code blocks

thinking is delayed it says processing for 2 seconds as if its prompt processing but prompt processing is actually done and the model is thinkg, when the thinking finally plays the timer is already at 2 seconds thinking. - chat for fixing claude --resume 2888c25f-0b38-40ce-b868-0849426069bf\

claude --resume 17aa6de3-fdb7-4b56-a876-ef76c2569d8c - was fixing interrupted downloads + adding interrupted downloads and downloading section to vllm model library

vllm with mcp speed,

model changing place in library after serving i think due ot scan - vllm

when logs cleared No output yet — start a server or select an instance. - make this light mode

we need to check how tps is calculated for vllm with mcp it seems slower than it actually is, maybe its counting the processing time as part of tps or something?

claude chat for mcp auto connect disconnect, mcp vllm tps, mcp vllm pp animation 
claude --resume 94970458-a578-417f-bccd-c56c45c2492d

claude chat for huggingface token settings and handling failed download, to preserve failed on reboot
claude --resume 203979a5-a76f-447c-a747-8a8ff97b06be

IMPORTANT - ADD WAY TO UPDATE APP FOR WHEN I RELEASE FUTURE VERSIONS
some vllm models will take long time to load, this is natural no need to stop it [llamafront] Server did not become healthy within 5 minutes — marking as error.

Resume this session with:
claude --resume e7c7bd23-1014-45e1-86c2-4ff4c05b832c - for vllm not installed disable

for later - downloaded button now disabled in model library cannot click it again to download already downloaded model into another dir.

renable vllm with mcp tps metric once metric is more accurate - Resume this session with:
claude --resume 964d16a8-f6ef-47aa-a93e-12716e50286a

at step where it says dynamobytecode - [stdout] (EngineCore pid=20986) INFO 05-23 16:29:53 [backends.py:1069] Using cache directory: /home/moody/.cache/vllm/torch_compile_cache/1c1926099d/rank_0_0/backbone for vLLM's torch.compile
[stdout] (EngineCore pid=20986) INFO 05-23 16:29:53 [backends.py:1128] Dynamo bytecode transform time: 2.55 s
[stdout] (EngineCore pid=20986) INFO 05-23 16:29:56 [backends.py:290] Directly load the compiled graph(s) for compile range (1, 2048) from the cache, took 2.526 s
the model gets removed from teh dropdown box in the model chat, as if i didnt have the model selected, but once it finishes loading the model gets selected automaticaly in the box

weird exclamation marks
mmproj path keeps reseting - add button to select mmproj file like when selecting llamacpp path - / button for autodetect reset

launch command seems to be using this --mmproj C:\unsloth\test\Qwen3.6-27B-Q6_K\mmproj-BF16.gguf -c 190000 -ngl 999 - changed by itself even though the ui for mmproj is set to C:\Users\mohda\models\unsloth\Qwen3.6-27B-Q6_K\mmproj-BF16.gguf

nvfp4 qwen 35b gets renamed to default in the model library in the model library

need to create a default vllm profile - check video input later

Noticed that logic for detecting if vision model to allow image input and image based pdf if its a vision based llamacpp model it will still allow upload of images even if vision is disabled, make it so that if vision is disabled disable the image option and go back to the text based pdf instead of image based. check implementation in vllm too.
