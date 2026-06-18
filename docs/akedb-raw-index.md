# AKEDatabase 原始数据摘要索引

`C:\Users\zsk86\Desktop\AKEDatabase-main\public\Json\DATA_HANDOVER.md` 是原始数据结构的事实来源。

当前项目不直接提交 AKEDatabase 的完整 `public/Json` dump。需要使用原始 SkillData/BuffData 时，运行：

```powershell
npm run akedb:extract
```

默认读取：

```text
C:\Users\zsk86\Desktop\AKEDatabase-main\public\Json
```

默认输出：

```text
public\data\akedb-raw-index
```

输出文件：

- `skills.json`：SkillData 精简到 8 个字段，保留 `blackboard[].isDynamic`。
- `buffs.json`：BuffData 精简到 7 个字段，展开 `attributeModifier.attributeModifiers`。
- `buff-skill-links.json`：按 `buffId -> skillId[]` 建立反向关联。
- `manifest.json`：来源、生成时间、数量校验、缺失关联 Buff 列表。

精度注意：

- 技能动作时长保持原始帧数，业务侧需要秒数时用 `durationFrame / 60`。
- `isDynamic: true` 的 blackboard 参数不是确定静态值，填表时应跳过或标记。
- v2 技能倍率是汇总口径，v1 多段倍率是分段口径，二者不能混算。
- agent 整理数据里的叠层值可能是公式推导值，不等同于原始字段。
