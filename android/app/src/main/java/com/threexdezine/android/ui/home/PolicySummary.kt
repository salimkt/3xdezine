package com.threexdezine.android.ui.home

import com.threexdezine.android.data.model.EditLevel
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.RuleSeverity

/**
 * One line describing a project's edit policy, pending proposals and their plan-check
 * result, e.g. "Finishes only · 2 proposals pending · plan check: 1 error". Null when the
 * project carries none of that. Pure so it is unit-tested.
 *
 * Read-only by design: this app has no geometry editor, so the only thing a policy
 * changes on Android is whether the material sheet may apply finishes (not at VIEW).
 */
fun policySummary(project: Project): String? {
    val parts = mutableListOf<String>()
    when (project.policy?.level) {
        EditLevel.VIEW -> parts += "View only"
        EditLevel.FINISHES -> parts += "Finishes only"
        EditLevel.LAYOUT -> parts += "Layout editable"
        EditLevel.FULL, null -> Unit
    }
    val pending = project.pendingProposals
    if (pending.isNotEmpty()) {
        parts += "${pending.size} proposal${plural(pending.size)} pending"
        val violations = pending.flatMap { it.violations }
        val errors = violations.count { it.severity == RuleSeverity.ERROR }
        val warnings = violations.count { it.severity == RuleSeverity.WARNING }
        parts += when {
            errors > 0 -> "plan check: $errors error${plural(errors)}"
            warnings > 0 -> "plan check: $warnings warning${plural(warnings)}"
            else -> "plan check: passes"
        }
    }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

/** Why materials cannot be applied, or null when they can. */
fun finishesLockedReason(project: Project): String? =
    if (project.canEditFinishes) {
        null
    } else {
        "This project is shared view-only, so finishes can't be changed here. " +
            "Ask its owner for at least \"finishes\" access."
    }

private fun plural(n: Int) = if (n == 1) "" else "s"
