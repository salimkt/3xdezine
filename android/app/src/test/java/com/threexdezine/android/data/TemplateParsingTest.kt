package com.threexdezine.android.data

import com.threexdezine.android.data.model.EditLevel
import com.threexdezine.android.data.model.PlanEdit
import com.threexdezine.android.data.model.PlanTemplateMeta
import com.threexdezine.android.data.model.Project
import com.threexdezine.android.data.model.ProposalStatus
import com.threexdezine.android.data.model.TemplateCategory
import com.threexdezine.android.data.remote.AppJson
import com.threexdezine.android.ui.home.finishesLockedReason
import com.threexdezine.android.ui.home.policySummary
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

class TemplateParsingTest {

    /** Unit tests run with the module (android/app) as the working directory. */
    private val shared = File("../../shared")

    private val projectJson = """
        {
          "${'$'}schema": "ignored",
          "name": "Test", "currency": "INR", "contingencyBuffer": 0.1,
          "templateId": "2bhk-compact",
          "somethingNew": {"nested": true},
          "policy": {"level": "FINISHES", "lockedWallIds": ["w1"], "requireReview": true},
          "proposals": [
            {
              "id": "p1", "author": "a", "createdAt": "2026-10-01T00:00:00Z",
              "status": "PENDING",
              "edits": [
                {"kind": "MOVE_CORNER", "from": {"x": 0, "z": 0}, "to": {"x": 0.5, "z": 0}},
                {"kind": "MOVE_OPENING", "openingId": "o1", "t": 0.3},
                {"kind": "RESIZE_OPENING", "openingId": "o1", "widthM": 1.2},
                {"kind": "ADD_OPENING", "opening": {"id": "o9", "wallId": "w2", "t": 0.5, "widthM": 0.9, "heightM": 2.1, "sillM": 0}},
                {"kind": "REMOVE_OPENING", "openingId": "o2"},
                {"kind": "SPLIT_WALL", "wallId": "w3", "at": 0.5}
              ],
              "violations": [
                {"ruleId": "room.min-area", "severity": "ERROR", "message": "too small", "roomId": "r1"},
                {"ruleId": "door.width", "severity": "WARNING", "message": "narrow"}
              ],
              "costDelta": -1200.5
            },
            {"id": "p2", "author": "b", "createdAt": "x", "status": "ACCEPTED", "edits": [], "violations": []}
          ],
          "floors": []
        }
    """.trimIndent()

    @Test
    fun projectWithPolicyAndProposalsParses() {
        val p = AppJson.decodeFromString(Project.serializer(), projectJson)
        assertEquals(EditLevel.FINISHES, p.policy?.level)
        assertEquals(listOf("w1"), p.policy?.lockedWallIds)
        assertEquals("2bhk-compact", p.templateId)
        val edits = p.proposals!!.first().edits
        assertTrue(edits[0] is PlanEdit.MoveCorner)
        assertEquals(0.3, (edits[1] as PlanEdit.MoveOpening).t, 1e-9)
        assertEquals(1.2, (edits[2] as PlanEdit.ResizeOpening).widthM, 1e-9)
        assertEquals("o9", (edits[3] as PlanEdit.AddOpening).opening.id)
        assertEquals("o2", (edits[4] as PlanEdit.RemoveOpening).openingId)
        assertEquals(PlanEdit.Unknown, edits[5])
        assertEquals(1, p.pendingProposals.size)
        assertEquals(ProposalStatus.ACCEPTED, p.proposals!![1].status)
        assertEquals(
            "Finishes only · 1 proposal pending · plan check: 1 error",
            policySummary(p),
        )
        assertTrue(p.canEditFinishes)
        assertNull(finishesLockedReason(p))
    }

    @Test
    fun planEditsRoundTripWithKindDiscriminator() {
        val edit: PlanEdit = PlanEdit.MoveOpening("o1", 0.25)
        val json = AppJson.encodeToString(PlanEdit.serializer(), edit)
        assertTrue(json, json.contains("\"kind\":\"MOVE_OPENING\""))
        assertEquals(edit, AppJson.decodeFromString(PlanEdit.serializer(), json))
    }

    @Test
    fun viewLevelLocksFinishes() {
        val p = AppJson.decodeFromString(
            Project.serializer(),
            """{"name":"V","currency":"INR","contingencyBuffer":0,"policy":{"level":"VIEW","lockedWallIds":[],"requireReview":false}}""",
        )
        assertFalse(p.canEditFinishes)
        assertNotNull(finishesLockedReason(p))
        assertEquals("View only", policySummary(p))
    }

    @Test
    fun projectWithoutPolicyIsEditableAndQuiet() {
        val p = AppJson.decodeFromString(Project.serializer(), """{"name":"N","currency":"INR","contingencyBuffer":0}""")
        assertTrue(p.canEditFinishes)
        assertNull(policySummary(p))
        assertTrue(p.pendingProposals.isEmpty())
    }

    @Test
    fun templateMetaParses() {
        val list = AppJson.decodeFromString(
            ListSerializer(PlanTemplateMeta.serializer()),
            """[{"id":"studio","name":"Studio","tagline":"t","category":"STUDIO","bhk":0,"builtUpSqm":32.5,"rooms":3,"styleId":"s","file":"studio.json","extra":1}]""",
        )
        assertEquals(TemplateCategory.STUDIO, list.single().category)
        assertEquals("studio.json", list.single().file)
    }

    @Test
    fun sharedSampleProjectParses() {
        val file = File(shared, "sample-project.json")
        assumeTrue("shared/ not reachable from ${File(".").absolutePath}", file.isFile)
        val p = AppJson.decodeFromString(Project.serializer(), file.readText())
        assertTrue(p.floors.isNotEmpty())
    }

    /** Runs against the real shared/templates once they exist; skipped before then. */
    @Test
    fun everySharedTemplateParses() {
        val index = File(shared, "templates/index.json")
        assumeTrue("shared/templates/index.json not present yet", index.isFile)
        val metas = AppJson.decodeFromString(ListSerializer(PlanTemplateMeta.serializer()), index.readText())
        assertTrue(metas.isNotEmpty())
        for (meta in metas) {
            val f = File(shared, "templates/${meta.file}")
            assertTrue("missing ${meta.file}", f.isFile)
            val p = AppJson.decodeFromString(Project.serializer(), f.readText())
            assertNotNull("${meta.file} has no ground floor", p.groundFloor)
        }
    }
}
